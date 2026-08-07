/**
 * 사관학교(육·해·공·3사·국간사) 입학 공지만 빠르게 수집해 univ 보드에 반영.
 * MIN_DATE(2026-08-01) 이후 글만 유지.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_DATE = "2026-08-01";
const MAX_PER = 8;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TARGETS = [
  {
    id: "u032",
    name: "육군사관학교",
    homeUrl: "https://www.kma.ac.kr:461/",
    boardUrl: "https://www.kma.ac.kr:461/kma/2100/subview.do",
    allow: /kma\.ac\.kr(?::\d+)?\/bbs\/kma\/160\/\d+\/artclView\.do/i,
    k2Path: "/bbs/kma/160/",
  },
  {
    id: "u245",
    name: "해군사관학교",
    homeUrl: "https://www.navy.ac.kr:4443/sites/iphak/index.do",
    boardUrl: "https://www.navy.ac.kr:4443/iphak/1630/subview.do",
    allow: /navy\.ac\.kr(?::\d+)?\/bbs\/iphak\/142\/\d+\/artclView\.do/i,
    k2Path: "/bbs/iphak/142/",
  },
  {
    id: "u123",
    name: "공군사관학교",
    homeUrl: "https://rokaf.airforce.mil.kr/sites/afaadmission/index.do",
    boardUrl: "https://rokaf.airforce.mil.kr/afaadmission/7161/subview.do",
    allow: /rokaf\.airforce\.mil\.kr\/bbs\/afaadmission\/2089\/\d+\/artclView\.do/i,
    parser: "afa",
  },
  {
    id: "u232",
    name: "육군3사관학교",
    homeUrl: "https://www.kaay.mil.kr:458/kaay/1142/subview.do",
    boardUrl: "https://www.kaay.mil.kr:458/kaay/1159/subview.do",
    allow: /kaay\.mil\.kr(?::\d+)?\/bbs\/kaay\/152\/\d+\/artclView\.do/i,
    k2Path: "/bbs/kaay/152/",
  },
  {
    id: "u109",
    name: "국군간호사관학교",
    homeUrl: "https://tapply.tonc.net/kafna/",
    boardUrl: "https://tapply.tonc.net/kafna/?doc=bbs/board.php&bo_table=notice",
    allow: /tapply\.tonc\.net\/kafna\/\?doc=bbs\/board\.php&.*bo_table=notice.*wr_id=\d+/i,
    parser: "kafna",
  },
];

function sha20(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
}

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toIso(y, mo, d) {
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (iso < "2020-01-01" || iso > "2035-12-31") return "";
  return iso;
}

function extractIso(text) {
  const full = [
    ...String(text || "").matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g),
  ];
  if (full.length) {
    const m = full[full.length - 1];
    return toIso(m[1], m[2], m[3]);
  }
  const yy = [...String(text || "").matchAll(/(?<!\d)(\d{2})-(\d{2})-(\d{2})(?!\d)/g)];
  if (!yy.length) return "";
  const m = yy[yy.length - 1];
  let y = Number(m[1]);
  y += y < 70 ? 2000 : 1900;
  return toIso(y, m[2], m[3]);
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function stripTags(s) {
  return decodeEntities(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(base, href) {
  try {
    return new URL(href, base).href.split("#")[0];
  } catch {
    return "";
  }
}

function makeItem(cfg, title, href, dateISO) {
  const today = seoulToday();
  title = stripTags(title)
    .replace(/^(새글|N|NEW|공지)\s*/i, "")
    .trim();
  if (!title || title.length < 8 || title.length > 140) return null;
  if (!dateISO || dateISO < MIN_DATE || dateISO > today) return null;
  if (!href || !cfg.allow.test(href)) return null;
  if (/채용\s*공고|근로장학생|문의드립니다/i.test(title)) return null;
  const key = `${cfg.id}|${href}|${title}`;
  return {
    id: sha20(key),
    univId: cfg.id,
    univName: cfg.name,
    title,
    preview: `${cfg.name} 입학 공지사항 미리보기`,
    url: href,
    homeUrl: cfg.homeUrl,
    dateISO,
    dateText: dateISO.replace(/-/g, "."),
  };
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.text();
}

function parseK2(html, cfg) {
  const out = [];
  const esc = cfg.k2Path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `href\\s*=\\s*["']([^"']*?${esc}\\d+/artclView\\.do)["'][\\s\\S]{0,1800}?<strong>([\\s\\S]{0,240}?)</strong>[\\s\\S]{0,1800}?(20\\d{2}\\s*[.\\-/]\\s*\\d{1,2}\\s*[.\\-/]\\s*\\d{1,2})`,
    "gi"
  );
  for (const m of html.matchAll(re)) {
    const href = absUrl(cfg.boardUrl, m[1]);
    const it = makeItem(cfg, m[2], href, extractIso(m[3]));
    if (it) out.push(it);
  }
  return out;
}

function parseAfa(html, cfg) {
  const out = [];
  const re =
    /<a\s+href\s*=\s*["']([^"']*?\/bbs\/afaadmission\/2089\/\d+\/artclView\.do)["'][^>]*class="[^"]*artclLinkView[^"]*"[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?class="_artclregDate"[\s\S]*?<dd>\s*([^<]+?)\s*<\/dd>/gi;
  for (const m of html.matchAll(re)) {
    const href = absUrl(cfg.boardUrl, m[1]);
    const it = makeItem(cfg, m[2], href, extractIso(m[3]));
    if (it) out.push(it);
  }
  if (!out.length) {
    return parseK2(html, { ...cfg, k2Path: "/bbs/afaadmission/2089/" });
  }
  return out;
}

function parseKafna(html, cfg) {
  const out = [];
  const re =
    /href=['"](\.\/\?doc=bbs\/board\.php&bo_table=notice[^'"]*?wr_id=(\d+)[^'"]*)['"][\s\S]{0,200}?<b>([\s\S]{0,200}?)<\/b>[\s\S]{0,400}?(?<!\d)(\d{2}-\d{2}-\d{2})(?!\d)/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://tapply.tonc.net/kafna/?doc=bbs/board.php&bo_table=notice&wr_id=${m[2]}`;
    const it = makeItem(cfg, m[3], href, extractIso(m[4]));
    if (it) out.push(it);
  }
  return out;
}

function loadPayload() {
  const jsPath = path.join(ROOT, "univ-board-data.js");
  if (fs.existsSync(jsPath)) {
    const raw = fs.readFileSync(jsPath, "utf8");
    const json = raw.split("=").slice(1).join("=").trim().replace(/;$/, "");
    try {
      return JSON.parse(json);
    } catch {
      /* fall through */
    }
  }
  const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8"));
  return { sources, notices: [], minDate: MIN_DATE, updatedAt: "" };
}

function savePayload(payload) {
  const jsPath = path.join(ROOT, "univ-board-data.js");
  const jsonPath = path.join(ROOT, "data", "univ-notices.json");
  const sourcesPath = path.join(ROOT, "univ-sources.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(jsPath, "window.UNIV_BOARD_DATA=" + JSON.stringify(payload) + ";\n", "utf8");
  fs.writeFileSync(sourcesPath, JSON.stringify(payload.sources || [], null, 2), "utf8");
}

function updateSources(sources) {
  const byId = new Map(TARGETS.map((t) => [t.id, t]));
  return (sources || []).map((s) => {
    const t = byId.get(s.id);
    if (!t) return s;
    return {
      ...s,
      name: t.name,
      homeUrl: t.homeUrl,
      boardUrl: t.boardUrl,
      priority: true,
    };
  });
}

async function scrapeOne(cfg) {
  const html = await fetchHtml(cfg.boardUrl);
  let items = [];
  if (cfg.parser === "afa") items = parseAfa(html, cfg);
  else if (cfg.parser === "kafna") items = parseKafna(html, cfg);
  else items = parseK2(html, cfg);
  const map = new Map();
  for (const it of items) map.set(`${it.url}|${it.title}`, it);
  return [...map.values()]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .slice(0, MAX_PER);
}

async function main() {
  const payload = loadPayload();
  payload.sources = updateSources(payload.sources);
  payload.minDate = MIN_DATE;
  const byId = new Map(TARGETS.map((t) => [t.id, t]));
  const notices = [];

  for (const n of payload.notices || []) {
    if (byId.has(n.univId)) continue;
    if (!n.dateISO || n.dateISO < MIN_DATE) continue;
    notices.push(n);
  }

  const results = await Promise.allSettled(
    TARGETS.map(async (cfg) => {
      const items = await scrapeOne(cfg);
      return { cfg, items };
    })
  );

  let ok = 0;
  for (const r of results) {
    if (r.status === "rejected") {
      console.log("ERR", r.reason?.message || r.reason);
      continue;
    }
    const { cfg, items } = r.value;
    const prev = (payload.notices || []).filter((n) => n.univId === cfg.id);
    if (items.length) {
      ok += 1;
      console.log(`${cfg.name}: ${items.length}건 (>=${MIN_DATE})`);
      for (const it of items.slice(0, 5)) {
        console.log(" ", it.dateISO, it.title.slice(0, 72));
        console.log("   ", it.url);
      }
      notices.push(...items);
    } else {
      console.log(`${cfg.name}: empty — keep previous ${prev.length}`);
      notices.push(...prev.filter((n) => cfg.allow.test(n.url || "")));
    }
  }

  notices.sort((a, b) => {
    const d = (b.dateISO || "").localeCompare(a.dateISO || "");
    return d || String(a.title || "").localeCompare(String(b.title || ""));
  });

  payload.notices = notices;
  payload.updatedAt = new Date().toISOString();
  savePayload(payload);
  console.log(`saved notices=${notices.length} academies_ok=${ok}/${TARGETS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
