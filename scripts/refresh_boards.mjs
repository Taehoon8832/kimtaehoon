/**
 * One-shot refresh for jobkorea + recruit boards (Node; Python optional).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// GitHub Actions / 일부 환경에서 대상 사이트 인증서·TLS 이슈 회피
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dateOnly(val) {
  const m = String(val || "").match(/(20\d{2}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function sha20(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
}

function dday(deadlineISO, today, alwaysHire = false) {
  if (alwaysHire) return "상시채용";
  if (!deadlineISO || !today) return "";
  if (deadlineISO >= "2069-01-01") return "상시채용";
  const d0 = Date.parse(`${today}T12:00:00+09:00`);
  const d1 = Date.parse(`${deadlineISO}T12:00:00+09:00`);
  if (Number.isNaN(d0) || Number.isNaN(d1)) return "";
  const diff = Math.round((d1 - d0) / 86400000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return "D-Day";
  return `마감+${Math.abs(diff)}`;
}

const CAREER_LABEL = {
  NEWBIE: "신입",
  EXPERIENCED: "경력",
  INTERN: "인턴",
  IRRELEVANT: "경력무관",
};
const EMP_LABEL = {
  PERMANENT: "정규직",
  CONTRACT: "계약직",
  INTERN: "인턴",
  FREELANCER: "프리랜서",
  DISPATCH: "파견직",
  PART_TIME: "파트타임",
};

function labelList(arr, map) {
  const list = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push(map[item] || item);
      continue;
    }
    if (item && typeof item === "object") {
      const code = String(item.code || item.type || "").toUpperCase();
      const text = String(item.text || item.name || "").trim();
      out.push(map[code] || text || code);
    }
  }
  return out.filter(Boolean);
}

function writeBoard(jsName, globalName, jsonRel, payload) {
  const jsonPath = path.join(ROOT, jsonRel);
  const jsPath = path.join(ROOT, jsName);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(
    jsPath,
    `window.${globalName}=${JSON.stringify(payload)};\n`,
    "utf8"
  );
  console.log(`wrote ${payload.count} → ${jsName}, ${jsonRel}`);
}

async function fetchJobkoreaPayload() {
  const API = "https://jk-bff-display-api.jobkorea.co.kr/v1/home/jobs/curated?sc=729";
  const headers = {
    "User-Agent": UA,
    Accept: "application/json",
    Referer: "https://www.jobkorea.co.kr/",
  };
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(API, { headers, redirect: "follow" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const payload = await res.json();
      if (!Array.isArray(payload?.jobList) || !payload.jobList.length) {
        throw new Error("empty jobList");
      }
      return payload;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr || new Error("jobkorea fetch failed");
}

async function refreshJobkorea() {
  const API = "https://jk-bff-display-api.jobkorea.co.kr/v1/home/jobs/curated?sc=729";
  const payload = await fetchJobkoreaPayload();
  const today = seoulToday();
  const jobList = Array.isArray(payload.jobList) ? payload.jobList : [];
  const notices = [];
  const seen = new Set();

  jobList.forEach((row, idx) => {
    const company = row?.company || {};
    const job = row?.job || {};
    const jobId = String(job.jobId || "").trim();
    const title = String(job.title || "").replace(/\s+/g, " ").trim();
    const companyName = String(company.companyName || "").replace(/\s+/g, " ").trim();
    if (!jobId || !title || title.length < 2 || !companyName || seen.has(jobId)) return;
    const dateISO = dateOnly(job.firstPostedAt);
    if (!dateISO || dateISO > today) return;
    seen.add(jobId);

    let deadlineISO = dateOnly(job.applicationEndAt);
    let alwaysHire = Boolean(job.alwaysHire);
    if (alwaysHire || (deadlineISO && deadlineISO >= "2069-01-01")) {
      deadlineISO = "";
      alwaysHire = true;
    }

    const bits = [];
    const careers = labelList(job.careerTypes || job.careerType, CAREER_LABEL);
    if (careers.length) bits.push(careers.join("·"));
    const emps = labelList(job.employmentTypes || job.employmentType, EMP_LABEL);
    if (emps.length) bits.push(emps.join("·"));
    const loc =
      job.locationName ||
      job.workLocationName ||
      (Array.isArray(job.locations) ? job.locations.map((l) => l?.name || l).filter(Boolean).join(" ") : "");
    if (loc) bits.push(String(loc).trim());
    const dd = dday(deadlineISO, today, alwaysHire);
    if (dd) bits.push(dd === "상시채용" ? dd : `마감 ${dd}`);
    if (deadlineISO && !alwaysHire) bits.push(`접수마감 ${deadlineISO.replace(/-/g, ".")}`);

    const url = `https://www.jobkorea.co.kr/Recruit/GI_Read/${jobId}`;
    const key = `${jobId}|${title}|${dateISO}`;
    notices.push({
      id: sha20(key),
      jobId,
      companyName,
      title,
      preview: (bits.join(" · ") || `${companyName} 인기 채용 공고`).slice(0, 160),
      url,
      dateISO,
      dateText: dateISO.replace(/-/g, "."),
      deadlineISO,
      deadlineText: deadlineISO ? deadlineISO.replace(/-/g, ".") : "",
      alwaysHire,
      popularRank: idx + 1,
      popularScore: job.score == null ? null : Number(job.score),
    });
  });

  if (!notices.length) throw new Error("jobkorea empty parse");

  notices.sort((a, b) => {
    if (a.dateISO !== b.dateISO) return b.dateISO.localeCompare(a.dateISO);
    return a.popularRank - b.popularRank;
  });

  const now = new Date().toISOString();
  writeBoard("jobkorea-board-data.js", "JOBKOREA_BOARD_DATA", "data/jobkorea-notices.json", {
    source: "https://www.jobkorea.co.kr/",
    api: API,
    section: "인기 JOB",
    updatedAt: now,
    checkedAt: now,
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: "ok",
  });
  console.log(`wrote ${notices.length} → jobkorea-board-data.js`);
  notices.slice(0, 5).forEach((n) => {
    console.log(n.dateISO, `#${n.popularRank}`, n.companyName, "|", n.title.slice(0, 40));
  });
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function shortUniv(name) {
  let n = String(name || "").replace(/\s+/g, " ").trim();
  if (/[가-힣]/.test(n)) {
    n = n.replace(/\s+/g, "").replace(/대학교/g, "대").replace(/대학/g, "대");
  }
  return n;
}

const RECRUIT_LIST_URL = "https://www.jinhakpro.com/recruit/list";
const RECRUIT_API_URL =
  "https://www.jinhakpro.com/api/applicant/recruit/sub-list?isOnlyOnlineApply=false&bookmarkSortType=1&majorCategoryCode=&sortType=1";
const RECRUIT_TYPE = { RS: "연구원", L: "강사", T: "비전임교원", P: "전임교원" };
const RECRUIT_METHOD = {
  H: "홈페이지지원",
  E: "이메일지원",
  P: "우편지원",
  V: "방문지원",
  O: "즉시지원",
};
const RECRUIT_ORGAN = {
  UNIV: "대학교",
  UNIV1: "대학교",
  UNIV2: "전문대학",
  UNIV3: "사이버대학교",
  RS1: "연구기관",
  CO: "기업",
  HOSP: "병원",
  GOV: "정부/공공/지자체",
};

function seoulDateFromIso(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
  return dateOnly(s);
}

function addDaysISO(iso, delta) {
  const m = String(iso || "").match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function recruitPreviewFromApi(item, deadlineISO, today) {
  const type = RECRUIT_TYPE[String(item.recruitTypeCode || "").toUpperCase()] || "";
  const regions = (Array.isArray(item.regionData) ? item.regionData : [])
    .map((r) => String(r?.region || "").trim())
    .filter(Boolean);
  let region = "";
  if (regions.length === 1) region = regions[0];
  else if (regions.length > 1) region = `${regions[0]} 외 ${regions.length - 1}`;
  const methods = (Array.isArray(item.applyMethodCode) ? item.applyMethodCode : [])
    .map((c) => RECRUIT_METHOD[String(c || "").toUpperCase()] || "")
    .filter(Boolean);
  const organ =
    RECRUIT_ORGAN[String(item.organCode || "").toUpperCase()] ||
    RECRUIT_ORGAN[String(item.organTypeCode || "").toUpperCase()] ||
    "";
  const parts = [];
  if (type) parts.push(type);
  if (region) parts.push(region);
  if (methods.length) parts.push(methods.slice(0, 3).join("/"));
  if (organ) parts.push(organ);
  const dd = dday(deadlineISO, today);
  if (dd && !String(dd).startsWith("마감+")) parts.push(`마감 ${dd}`);
  if (deadlineISO) parts.push(`접수마감 ${deadlineISO.replace(/-/g, ".")}`);
  return parts.join(" · ") || "석·박사 채용 정보";
}

function noticesFromRecruitApi(items, today) {
  const rows = [];
  for (const item of items || []) {
    const rid = item?.recruitIdx;
    if (rid == null) continue;
    const id = String(rid);
    const title = String(item.recruitTitle || "").replace(/\s+/g, " ").trim();
    const organ = String(item.organName || "").replace(/\s+/g, " ").trim();
    if (!title || title.length < 4) continue;
    const registerISO = seoulDateFromIso(item.registerTime);
    const publishISO = seoulDateFromIso(item.publishStartTime);
    const applyStartISO = seoulDateFromIso(item.applyStartTime);
    const dateISO = registerISO || publishISO || applyStartISO;
    if (!dateISO || dateISO > today) continue;
    const deadlineISO =
      seoulDateFromIso(item.applyEndTime) || seoulDateFromIso(item.applyEarlyEndTime) || "";
    const univName = shortUniv(organ) || organ || "기관";
    const key = `${id}|${title}|${dateISO}`;
    rows.push({
      id: sha20(key),
      recruitId: id,
      univName,
      univFull: organ || univName,
      title,
      preview: recruitPreviewFromApi(item, deadlineISO, today).slice(0, 160),
      url: `https://www.jinhakpro.com/recruit/${id}`,
      dateISO,
      dateText: dateISO.replace(/-/g, "."),
      deadlineISO,
      deadlineText: deadlineISO ? deadlineISO.replace(/-/g, ".") : "",
      registerAt: String(item.registerTime || ""),
    });
  }
  rows.sort((a, b) => {
    if (a.dateISO !== b.dateISO) return b.dateISO.localeCompare(a.dateISO);
    return String(b.registerAt).localeCompare(String(a.registerAt));
  });
  const minDate = addDaysISO(today, -3) || today;
  const recent = rows.filter((r) => r.dateISO >= minDate);
  const picked = (recent.length >= 12 ? recent : rows).slice(0, 48);
  picked.forEach((n) => delete n.registerAt);
  return picked;
}

function parseNuxtRecruits(html) {
  const m = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const resolve = (ref) => {
    if (typeof ref === "number" && ref >= 0 && ref < data.length) return data[ref];
    return ref;
  };

  // Prefer the sub-list payload order (matches https://www.jinhakpro.com/recruit/list)
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [k, v] of Object.entries(item)) {
      if (!String(k).includes("/applicant/recruit/sub-list")) continue;
      const arr = resolve(v);
      if (!Array.isArray(arr) || !arr.length) continue;
      const out = [];
      for (const ref of arr) {
        const obj = resolve(ref);
        if (!obj || typeof obj !== "object") continue;
        out.push({
          recruitIdx: resolve(obj.recruitIdx),
          recruitTitle: resolve(obj.recruitTitle),
          recruitTypeCode: resolve(obj.recruitTypeCode),
          registerTime: resolve(obj.registerTime),
          publishStartTime: resolve(obj.publishStartTime),
          applyStartTime: resolve(obj.applyStartTime),
          applyEndTime: resolve(obj.applyEndTime),
          applyEarlyEndTime: resolve(obj.applyEarlyEndTime),
          applyMethodCode: resolve(obj.applyMethodCode),
          regionData: resolve(obj.regionData),
          organName: resolve(obj.organName),
          organTypeCode: resolve(obj.organTypeCode),
          organCode: resolve(obj.organCode),
        });
      }
      if (out.length) return out;
    }
  }

  const loose = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!("recruitIdx" in item)) continue;
    const ridVal = resolve(item.recruitIdx);
    if (typeof ridVal !== "number") continue;
    loose.push({
      recruitIdx: ridVal,
      recruitTitle: resolve(item.recruitTitle),
      recruitTypeCode: resolve(item.recruitTypeCode),
      registerTime: resolve(item.registerTime),
      publishStartTime: resolve(item.publishStartTime),
      applyStartTime: resolve(item.applyStartTime),
      applyEndTime: resolve(item.applyEndTime),
      applyEarlyEndTime: resolve(item.applyEarlyEndTime),
      applyMethodCode: resolve(item.applyMethodCode),
      regionData: resolve(item.regionData),
      organName: resolve(item.organName),
      organTypeCode: resolve(item.organTypeCode),
      organCode: resolve(item.organCode),
    });
  }
  return loose;
}

async function fetchRecruitApi() {
  const headers = {
    "User-Agent": UA,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    Referer: RECRUIT_LIST_URL,
    Origin: "https://www.jinhakpro.com",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  let lastErr = null;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(RECRUIT_API_URL, { headers, redirect: "follow" });
      const text = await res.text();
      if (!res.ok) throw new Error(`http_${res.status}:${text.slice(0, 120)}`);
      if (/just a moment|cloudflare|cf-browser-verification/i.test(text)) {
        throw new Error("cloudflare_challenge");
      }
      const data = JSON.parse(text);
      if (!Array.isArray(data) || !data.length) throw new Error("api_empty");
      if (!data[0]?.recruitIdx || !data[0]?.recruitTitle) throw new Error("api_shape");
      return data;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastErr || new Error("recruit api failed");
}

async function fetchRecruitHtmlFallback() {
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    Referer: "https://www.jinhakpro.com/",
  };
  try {
    const res = await fetch(RECRUIT_LIST_URL, { headers, redirect: "follow" });
    if (res.ok) {
      const html = await res.text();
      if (
        html.length > 800 &&
        html.includes("__NUXT_DATA__") &&
        !(html.includes("Security Check") && html.length < 5000)
      ) {
        return html;
      }
      console.warn("recruit: thin/blocked direct html, trying jina");
    } else {
      console.warn(`recruit: direct http_${res.status}, trying jina`);
    }
  } catch (e) {
    console.warn("recruit: direct fetch failed", e?.message || e);
  }
  const mirror = await fetch("https://r.jina.ai/" + RECRUIT_LIST_URL, {
    headers: { "User-Agent": UA, Accept: "text/plain,*/*" },
    redirect: "follow",
  });
  if (!mirror.ok) throw new Error(`recruit jina http_${mirror.status}`);
  const text = await mirror.text();
  if (text.length < 400) throw new Error("recruit jina empty");
  return text;
}

async function refreshRecruit(apiItems = null) {
  const today = seoulToday();
  let items = apiItems;
  let sourceMode = apiItems ? "api_file" : "api";
  if (!items) {
    try {
      items = await fetchRecruitApi();
      console.log(`recruit api items=${items.length}`);
    } catch (e) {
      console.warn("recruit api failed, falling back to list html:", e?.message || e);
      const html = await fetchRecruitHtmlFallback();
      items = parseNuxtRecruits(html);
      sourceMode = "html_nuxt";
      console.log(`recruit html/nuxt items=${items.length}`);
    }
  } else {
    console.log(`recruit api file items=${items.length}`);
  }

  const notices = noticesFromRecruitApi(items, today);
  if (!notices.length) throw new Error("recruit empty parse");

  const now = new Date().toISOString();
  writeBoard("recruit-board-data.js", "RECRUIT_BOARD_DATA", "data/recruit-notices.json", {
    source: RECRUIT_LIST_URL,
    api: RECRUIT_API_URL,
    updatedAt: now,
    checkedAt: now,
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: `ok:${sourceMode}`,
  });
  console.log(`wrote ${notices.length} → recruit-board-data.js (${sourceMode})`);
  notices.slice(0, 5).forEach((n) => {
    console.log(n.dateISO, n.deadlineISO, n.univName, "|", n.title.slice(0, 42));
  });
}

function loadPrevNotices(jsonRel) {
  try {
    const p = path.join(ROOT, jsonRel);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(data?.notices) && data.notices.length ? data : null;
  } catch {
    return null;
  }
}

async function safeRefresh(name, fn, jsonRel, strict) {
  try {
    await fn();
  } catch (err) {
    const prev = loadPrevNotices(jsonRel);
    if (strict) {
      if (prev) {
        console.error(
          `${name} failed (strict) but previous cache exists (${prev.notices.length}):`,
          err?.message || err
        );
      }
      throw err;
    }
    if (prev) {
      console.error(`${name} failed, keeping previous ${prev.notices.length} items:`, err?.message || err);
      return;
    }
    throw err;
  }
}

const only = (() => {
  const arg = process.argv.find((a) => a.startsWith("--only="));
  return arg ? arg.slice("--only=".length).trim() : "";
})();
const strict = process.argv.includes("--strict");
const apiFile = (() => {
  const arg = process.argv.find((a) => a.startsWith("--api-file="));
  return arg ? arg.slice("--api-file=".length).trim() : "";
})();

console.log("ROOT=", ROOT, only ? `only=${only}` : "all", strict ? "strict" : "", apiFile ? `api-file=${apiFile}` : "");
if (!only || only === "jobkorea") {
  await safeRefresh("jobkorea", refreshJobkorea, "data/jobkorea-notices.json", strict);
}
if (!only || only === "recruit") {
  if (apiFile) {
    const raw = fs.readFileSync(apiFile, "utf8");
    if (/just a moment|cloudflare/i.test(raw)) {
      throw new Error("api-file cloudflare_challenge");
    }
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.length) throw new Error("api-file empty");
    await safeRefresh(
      "recruit",
      () => refreshRecruit(data),
      "data/recruit-notices.json",
      strict
    );
  } else {
    // JobKorea와 동일: --strict 가 있을 때만 실패 전파. --only=recruit 만으로는 캐시 유지 허용.
    await safeRefresh("recruit", () => refreshRecruit(null), "data/recruit-notices.json", strict);
  }
}
console.log("done");
