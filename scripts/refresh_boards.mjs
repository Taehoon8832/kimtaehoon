/**
 * One-shot refresh for jobkorea + recruit boards (Node; Python optional).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function refreshJobkorea() {
  const API = "https://jk-bff-display-api.jobkorea.co.kr/v1/home/jobs/curated?sc=729";
  const res = await fetch(API, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      Referer: "https://www.jobkorea.co.kr/",
    },
  });
  if (!res.ok) throw new Error(`jobkorea http_${res.status}`);
  const payload = await res.json();
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

  notices.sort((a, b) => {
    if (a.dateISO !== b.dateISO) return b.dateISO.localeCompare(a.dateISO);
    return a.popularRank - b.popularRank;
  });

  writeBoard("jobkorea-board-data.js", "JOBKOREA_BOARD_DATA", "data/jobkorea-notices.json", {
    source: "https://www.jobkorea.co.kr/",
    api: API,
    section: "인기 JOB",
    updatedAt: new Date().toISOString(),
    today,
    count: notices.length,
    notices,
  });
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

function parseNuxtRecruits(html) {
  const m = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return {};
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return {};
  }
  if (!Array.isArray(data)) return {};

  const resolve = (ref) => {
    if (typeof ref === "number" && ref >= 0 && ref < data.length) return data[ref];
    return ref;
  };

  const out = {};
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!("recruitIdx" in item)) continue;
    const ridVal = resolve(item.recruitIdx);
    if (typeof ridVal !== "number") continue;
    const title = String(resolve(item.recruitTitle) || "").replace(/\s+/g, " ").trim();
    const organ = String(resolve(item.organName) || "").replace(/\s+/g, " ").trim();
    const register = dateOnly(resolve(item.registerTime));
    const publishStart = dateOnly(resolve(item.publishStartTime));
    const applyStart = dateOnly(resolve(item.applyStartTime));
    const applyEnd = dateOnly(resolve(item.applyEndTime) || resolve(item.applyEarlyEndTime));
    const dateISO = register || publishStart || applyStart;
    if (!dateISO || !title) continue;
    out[String(ridVal)] = {
      title,
      univFull: organ,
      univName: shortUniv(organ) || organ || "기관",
      dateISO,
      deadlineISO: applyEnd || "",
    };
  }
  return out;
}

function parseCards(html) {
  const blocks = String(html || "").split(/(?=<a[^>]+href="\/recruit\/\d+")/);
  const items = [];
  const seen = new Set();
  for (const b of blocks) {
    const hm = b.match(/href="(\/recruit\/(\d+))"/i);
    if (!hm) continue;
    const rid = hm[2];
    if (seen.has(rid)) continue;
    seen.add(rid);

    let infoBits = [];
    const infoM = b.match(/class="card_recr_info"[^>]*>([\s\S]*?)<\/p>/i);
    if (infoM) {
      infoBits = [...infoM[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
        .map((x) => stripTags(x[1]))
        .filter((x) => x && x !== "스크랩" && x !== "관심 스크랩");
    }
    const tags = [...b.matchAll(/class="card_ctg"[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((x) => stripTags(x[1]))
      .filter((x) => x && x !== "마감임박");
    const periodM = b.match(/class="card_period"[^>]*>([\s\S]*?)<\/p>/i);
    let deadlineISO = "";
    if (periodM) {
      const dm = stripTags(periodM[1]).match(
        /(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/
      );
      if (dm) {
        deadlineISO = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
      }
    }
    items.push({
      id: rid,
      url: `https://www.jinhakpro.com/recruit/${rid}`,
      tags,
      infoBits,
      deadlineISO,
      listOrder: items.length,
    });
  }
  return items;
}

async function fetchRecruitHtml() {
  const LIST_URL = "https://www.jinhakpro.com/recruit/list";
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    Referer: "https://www.jinhakpro.com/",
  };
  try {
    const res = await fetch(LIST_URL, { headers, redirect: "follow" });
    if (res.ok) {
      const html = await res.text();
      if (
        html.length > 800 &&
        (html.includes("__NUXT_DATA__") || /href="\/recruit\/\d+"/.test(html)) &&
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
  const mirror = await fetch("https://r.jina.ai/" + LIST_URL, {
    headers: { "User-Agent": UA, Accept: "text/plain,*/*" },
    redirect: "follow",
  });
  if (!mirror.ok) throw new Error(`recruit jina http_${mirror.status}`);
  const text = await mirror.text();
  if (text.length < 400) throw new Error("recruit jina empty");
  return text;
}

async function refreshRecruit() {
  const LIST_URL = "https://www.jinhakpro.com/recruit/list";
  const html = await fetchRecruitHtml();
  const today = seoulToday();
  const nuxt = parseNuxtRecruits(html);
  const cards = parseCards(html);
  console.log(`cards=${cards.length} nuxt=${Object.keys(nuxt).length}`);

  const notices = [];
  for (const c of cards) {
    const meta = nuxt[c.id];
    if (!meta) continue;
    if (meta.dateISO > today) continue;
    if (meta.title.length < 4) continue;
    const deadline = meta.deadlineISO || c.deadlineISO || "";
    const parts = [];
    if (c.tags?.length) parts.push(c.tags.slice(0, 3).join(" · "));
    if (c.infoBits?.length) parts.push(c.infoBits.slice(0, 3).join(" · "));
    const dd = dday(deadline, today);
    if (dd) parts.push(`마감 ${dd}`);
    if (deadline) parts.push(`접수마감 ${deadline.replace(/-/g, ".")}`);
    const key = `${c.id}|${meta.title}|${meta.dateISO}`;
    notices.push({
      id: sha20(key),
      recruitId: c.id,
      univName: meta.univName,
      univFull: meta.univFull || meta.univName,
      title: meta.title,
      preview: (parts.join(" · ") || "석·박사 채용 정보").slice(0, 160),
      url: c.url,
      dateISO: meta.dateISO,
      dateText: meta.dateISO.replace(/-/g, "."),
      deadlineISO: deadline,
      deadlineText: deadline ? deadline.replace(/-/g, ".") : "",
      listOrder: c.listOrder,
    });
  }

  if (!notices.length) throw new Error("recruit empty parse");

  notices.sort((a, b) => {
    if (a.dateISO !== b.dateISO) return b.dateISO.localeCompare(a.dateISO);
    return b.listOrder - a.listOrder;
  });
  notices.forEach((n) => delete n.listOrder);

  const now = new Date().toISOString();
  writeBoard("recruit-board-data.js", "RECRUIT_BOARD_DATA", "data/recruit-notices.json", {
    source: LIST_URL,
    updatedAt: now,
    checkedAt: now,
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: "ok",
  });
  console.log(`wrote ${notices.length} → recruit-board-data.js`);
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

async function safeRefresh(name, fn, jsonRel) {
  try {
    await fn();
  } catch (err) {
    const prev = loadPrevNotices(jsonRel);
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

console.log("ROOT=", ROOT, only ? `only=${only}` : "all");
if (!only || only === "jobkorea") {
  await safeRefresh("jobkorea", refreshJobkorea, "data/jobkorea-notices.json");
}
if (!only || only === "recruit") {
  await safeRefresh("recruit", refreshRecruit, "data/recruit-notices.json");
}
console.log("done");
