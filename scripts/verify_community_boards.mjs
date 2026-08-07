/**
 * Accurate local crawl for teacher / suhui / edu boards (Python fallback).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
function toIso(y, m, d) {
  return `${String(Number(y)).padStart(4, "0")}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
}
function extractDate(text) {
  const m = String(text || "").match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  return m ? toIso(m[1], m[2], m[3]) : "";
}
function strip(s) {
  let out = String(s || "");
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
    if (next === out) break;
    out = next;
  }
  return out.replace(/<\/?[a-zA-Z!][^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function sha(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
}
function tsIso(ms, today) {
  if (!ms) return "";
  const iso = new Date(Number(ms) + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return iso > today ? today : iso;
}
function mdYy(raw, today) {
  const m = String(raw || "").match(/(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{2})?/);
  if (!m) return "";
  let year = Number(today.slice(0, 4));
  let iso = toIso(year, m[1], m[2]);
  if (iso > today) iso = toIso(year - 1, m[1], m[2]);
  return iso && iso <= today ? iso : "";
}
async function fetchText(url, headers = {}, timeout = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/json,*/*",
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // euc-kr fallback for jongro
    const utf = buf.toString("utf8");
    if (utf.includes("�") || /charset=euc-kr/i.test(utf.slice(0, 500))) {
      try {
        return new TextDecoder("euc-kr").decode(buf);
      } catch {
        return utf;
      }
    }
    return utf;
  } finally {
    clearTimeout(t);
  }
}
function writeBoard(jsName, jsonRel, globalName, payload) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, jsonRel), JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(path.join(ROOT, jsName), `window.${globalName}=${JSON.stringify(payload)};\n`, "utf8");
}
function makeItem(src, title, href, dateISO, preview, today) {
  title = strip(title).replace(/^(새글|N|NEW|공지|필독)\s*/i, "");
  if (!title || title.length < 8 || title.length > 160) return null;
  if (/^(http|www\.|로그인|회원가입|더보기|구독)/i.test(title)) return null;
  if (/^[은는이가을를에의와과도만]\s/.test(title)) return null;
  if ((title.match(/[가-힣a-zA-Z0-9]/g) || []).length < 6) return null;
  if (!dateISO || dateISO > today || dateISO < "2020-01-01") return null;
  if (!/^https?:\/\//i.test(href)) return null;
  return {
    id: sha(`${src.id}|${href}|${title}`),
    sourceId: src.id,
    sourceName: src.name,
    title: title.slice(0, 160),
    preview: strip(preview).slice(0, 120) || `${src.name} 소식`,
    url: href.split("#")[0],
    dateISO,
    dateText: dateISO.replace(/-/g, "."),
  };
}

function elapsedToIso(elapsed, today) {
  const s = strip(elapsed);
  if (!s || /방금|분\s*전|시간|오늘/.test(s)) return today;
  if (s.includes("어제")) {
    const d = new Date(`${today}T12:00:00+09:00`);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  const day = s.match(/(\d+)\s*일\s*전/);
  if (day) {
    const d = new Date(`${today}T12:00:00+09:00`);
    d.setDate(d.getDate() - Number(day[1]));
    return d.toISOString().slice(0, 10);
  }
  return extractDate(s) || today;
}

async function buildTeacher(today) {
  const source = "https://cafe.daum.net/applymate/Alvz";
  const api =
    "https://m.cafe.daum.net/api/v1/common-articles?grpid=1YpPw&fldid=Alvz&targetPage=1&pageSize=40";
  const data = JSON.parse(
    await fetchText(api, {
      Accept: "application/json,*/*",
      Referer: "https://m.cafe.daum.net/applymate/Alvz",
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    })
  );
  const notices = (data.articles || [])
    .map((art) => {
      const title = strip(art.title || "").replace(/^(새글|N|NEW|공지)\s*/i, "");
      if (!title || title.length < 4) return null;
      const dateISO = elapsedToIso(art.articleElapsedTime || "", today);
      return {
        id: sha(`${art.dataid}|${title}|${dateISO}`),
        sourceName: "사립학교 정교사",
        title: title.slice(0, 140),
        preview: strip(art.headCont || "").slice(0, 120),
        url: "",
        dateISO,
        dateText: dateISO.replace(/-/g, "."),
      };
    })
    .filter(Boolean);
  writeBoard("teacher-board-data.js", "data/teacher-notices.json", "TEACHER_BOARD_DATA", {
    source,
    updatedAt: utcNow(),
    checkedAt: utcNow(),
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: "ok",
  });
  console.log("teacher", notices.length);
}

async function buildSuhui(today) {
  const cafeId = "10197921";
  const source = `https://cafe.naver.com/f-e/cafes/${cafeId}/menus/0?viewType=L`;
  const api = `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${cafeId}/menus/0/articles?page=1&pageSize=40&sortBy=TIME&viewType=L`;
  const data = JSON.parse(await fetchText(api, { Referer: "https://cafe.naver.com/", Accept: "application/json,*/*" }));
  const notices = (data.result?.articleList || [])
    .map((row) => {
      const it = row.item || row;
      const title = strip(it.subject || "").replace(/^(새글|N|NEW|공지|필독)\s*/i, "");
      const aid = it.articleId || it.id;
      if (!title || !aid) return null;
      const dateISO = tsIso(it.writeDateTimestamp, today) || today;
      const url = `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/${aid}`;
      let preview = strip(it.summary || "").slice(0, 120) || "수만휘 카페 글";
      const menu = strip(it.menuName || "");
      if (menu) preview = `[${menu}] ${preview}`.slice(0, 120);
      return {
        id: sha(`${url}|${title}`),
        sourceName: "수만휘",
        title: title.slice(0, 140),
        preview,
        url,
        dateISO,
        dateText: dateISO.replace(/-/g, "."),
      };
    })
    .filter(Boolean);
  writeBoard("suhui-board-data.js", "data/suhui-notices.json", "SUHUI_BOARD_DATA", {
    source,
    updatedAt: utcNow(),
    checkedAt: utcNow(),
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: "ok",
  });
  console.log("suhui", notices.length);
}

const SOURCES = [
  { id: "kice_notice", name: "평가원공지", url: "https://www.suneung.re.kr/boardCnts/list.do?boardID=1500229&m=0301&s=suneung&searchStr=", kind: "kice", board: "1500229", menu: "0301" },
  { id: "kice_press", name: "평가원보도", url: "https://www.suneung.re.kr/boardCnts/list.do?boardID=1500230&m=0302&s=suneung&searchStr=", kind: "kice", board: "1500230", menu: "0302" },
  { id: "veritas", name: "베리타스알파", url: "https://www.veritas-a.com/news/articleList.html?sc_section_code=S1N2&view_type=sm", kind: "newsmp", base: "https://www.veritas-a.com" },
  { id: "ebsi", name: "EBSi", url: "https://www.ebsi.co.kr/ebs/pot/poth/retrieveNotcRmTotList.ebs", kind: "ebsi" },
  { id: "moe_blog", name: "교육부블로그", url: "https://blog.naver.com/PostList.naver?blogId=moeblog", kind: "moe_blog", api: "https://m.blog.naver.com/api/blogs/moeblog/post-list?categoryNo=0&itemCount=20&page=1" },
  { id: "edupress", name: "에듀프레스", url: "https://www.edupress.kr/news/articleList.html?sc_section_code=S1N5&view_type=sm", kind: "edupress", base: "https://www.edupress.kr" },
  { id: "edujin", name: "에듀진", url: "https://www.edujin.co.kr/news/articleList.html?sc_sub_section_code=S2N91&view_type=sm", kind: "newsmp", base: "https://www.edujin.co.kr" },
  { id: "nextplay", name: "괜찮은뉴스", url: "https://www.nextplay.kr/news/articleList.html?sc_section_code=S1N1&view_type=sm", kind: "newsmp", base: "https://www.nextplay.kr" },
  { id: "unn", name: "한국대학신문", url: "https://news.unn.net/news/articleList.html?sc_section_code=S1N92&view_type=sm", kind: "newsmp", base: "https://news.unn.net" },
  { id: "adiga", name: "어디가", url: "https://www.adiga.kr/cct/pbf/noticeView.do?menuId=PCCCTPBF1000", kind: "adiga" },
  { id: "jongro", name: "종로학원", url: "https://www.jongro.co.kr/reports/examAnalysisList.asp", kind: "jongro" },
  { id: "sen", name: "서울시교육청", url: "https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036", kind: "sen" },
  { id: "moe", name: "교육부", url: "https://www.moe.go.kr/boardCnts/listRenew.do?boardID=337&m=0303&s=moe", kind: "moe" },
];

function parseNewsmp(html, src, today) {
  const out = [];
  const re =
    /class="titles"[\s\S]{0,80}?href="((?:https?:\/\/[^"]*)?\/news\/articleView\.html\?[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>[\s\S]{0,1000}?class="byline"[\s\S]{0,400}?(20\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = new URL(m[1].replace(/&amp;/g, "&"), (src.base || "") + "/").href;
    const it = makeItem(src, m[2], href, extractDate(m[3]), `${src.name} 소식`, today);
    if (it) out.push(it);
  }
  return out;
}
function parseEdupress(html, src, today) {
  const out = [];
  const re =
    /href="((?:https?:\/\/[^"]*)?\/news\/articleView\.html\?idxno=\d+)"[^>]*>\s*([\s\S]{0,220}?)\s*<\/a>[\s\S]{0,900}?(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = new URL(m[1].replace(/&amp;/g, "&"), src.base + "/").href;
    const title = strip(m[2]);
    if (title.length < 10) continue;
    const it = makeItem(src, title, href, mdYy(m[3], today), `${src.name} 소식`, today);
    if (it) out.push(it);
  }
  return out;
}
function parseKice(html, src, today) {
  const out = [];
  const re =
    /goView\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,[^)]*\)[\s\S]{0,240}?>([\s\S]{0,200}?)<\/a>[\s\S]{0,260}?(20\d{2}-\d{2}-\d{2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = `https://www.suneung.re.kr/boardCnts/view.do?boardID=${m[1]}&boardSeq=${m[2]}&lev=0&m=${src.menu}&s=suneung`;
    const it = makeItem(src, m[3], href, m[4], `${src.name} 공지`, today);
    if (it) out.push(it);
  }
  return out;
}
function parseMoe(html, src, today) {
  const out = [];
  const re =
    /goView\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,[^)]*\)[\s\S]{0,240}?>([\s\S]{0,200}?)<\/a>[\s\S]{0,260}?(20\d{2}-\d{2}-\d{2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = `https://www.moe.go.kr/boardCnts/viewRenew.do?boardID=${m[1]}&boardSeq=${m[2]}&lev=0&m=0303&s=moe`;
    const it = makeItem(src, m[3], href, m[4], "교육부 정책", today);
    if (it) out.push(it);
  }
  return out;
}
function parseEbsi(html, src, today) {
  const out = [];
  const re =
    /goView\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'\)[\s\S]{0,300}?class="cout_tf"[^>]*>([\s\S]{0,220}?)<\/span>[\s\S]{0,400}?(\d{2}\.\d{2}\.\d{2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = `https://www.ebsi.co.kr/ebs/pot/poth/retrieveNotcRmTotArtcl.ebs?bbsId=${encodeURIComponent(m[1])}&artclId=${encodeURIComponent(m[2])}`;
    const [yy, mo, dd] = m[4].split(".");
    const it = makeItem(src, m[3], href, toIso(2000 + Number(yy), mo, dd), "EBSi 알림", today);
    if (it) out.push(it);
  }
  return out;
}
function parseAdiga(html, src, today) {
  const out = [];
  const re =
    /fnDetailPage\(\s*(?:&quot;|")(\d+)(?:&quot;|")\s*\)">([\s\S]{0,200}?)<\/a>[\s\S]{0,200}?(20\d{2}-\d{2}-\d{2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = `https://www.adiga.kr/cct/pbf/noticeDetail.do?menuId=PCCCTPBF1000&prtlBbsId=${m[1]}`;
    const it = makeItem(src, m[2], href, m[3], "어디가 공지", today);
    if (it) out.push(it);
  }
  return out;
}
function parseJongro(html, src, today) {
  const out = [];
  const re =
    /JavaScript:Read\((\d+)\);">([\s\S]{0,200}?)<\/a>[\s\S]{0,260}?class="info_date"[^>]*>(20\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2})/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = `https://www.jongro.co.kr/reports/examAnalysisView.asp?idx=${m[1]}&page=1&s_academicyear=&s_option1=&s_option2=&s_option3=&s_option4=&s_key=&s_value=&s_intPageSize=12`;
    const it = makeItem(src, m[2], href, extractDate(m[3]), "종로학원 입시분석", today);
    if (it) out.push(it);
  }
  return out;
}
function parseSen(html, src, today) {
  const out = [];
  const re =
    /data-name='연도'[^>]*>\s*(\d{4})\s*<[\s\S]{0,260}?data-name='월'[^>]*>\s*(\d{1,2})\s*<[\s\S]{0,500}?class="bbs_title[^"]*"[^>]*>\s*([\s\S]{0,160}?)\s*<\/td>/gi;
  let m;
  while ((m = re.exec(html))) {
    let dateISO = toIso(m[1], m[2], 28);
    if (dateISO > today) dateISO = toIso(m[1], m[2], 1);
    if (dateISO > today) continue;
    const it = makeItem(src, m[3], src.url, dateISO, "서울시교육청 학력평가", today);
    if (it) out.push(it);
  }
  return out;
}
async function scrapeMoeBlog(src, today) {
  const raw = await fetchText(src.api, {
    Accept: "application/json,*/*",
    Referer: "https://m.blog.naver.com/moeblog",
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
  });
  const data = JSON.parse(raw);
  const out = [];
  for (const it of data.result?.items || []) {
    const title = strip(it.titleWithInspectMessage || "");
    if (!title || !it.logNo) continue;
    const href = `https://blog.naver.com/moeblog/${it.logNo}`;
    const row = makeItem(src, title, href, tsIso(it.addDate, today) || today, it.briefContents || "교육부 블로그", today);
    if (row) out.push(row);
  }
  return out;
}

async function scrapeOne(src, today) {
  try {
    let items = [];
    if (src.kind === "moe_blog") items = await scrapeMoeBlog(src, today);
    else {
      const html = await fetchText(src.url, { Referer: src.url });
      const map = {
        newsmp: parseNewsmp,
        edupress: parseEdupress,
        kice: parseKice,
        moe: parseMoe,
        ebsi: parseEbsi,
        adiga: parseAdiga,
        jongro: parseJongro,
        sen: parseSen,
      };
      items = (map[src.kind] || (() => []))(html, src, today);
    }
    const uniq = new Map();
    for (const it of items) uniq.set(`${it.url}|${it.title}`, it);
    const out = [...uniq.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, 8);
    console.log(src.name, out.length);
    return out;
  } catch (e) {
    console.log(src.name, "ERR", e.message);
    return [];
  }
}

async function buildEdu(today) {
  const chunks = await Promise.all(SOURCES.map((s) => scrapeOne(s, today)));
  let notices = chunks.flat();
  const uniq = new Map();
  for (const n of notices) uniq.set(`${n.sourceId}|${n.url}|${n.title}`, n);
  notices = [...uniq.values()]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.title.localeCompare(b.title, "ko"))
    .slice(0, 104);
  writeBoard("edu-board-data.js", "data/edu-notices.json", "EDU_BOARD_DATA", {
    source: "multi",
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, url: s.url })),
    updatedAt: utcNow(),
    checkedAt: utcNow(),
    today,
    count: notices.length,
    notices,
    stale: false,
    status: "fresh",
    statusReason: "ok",
  });
  const by = {};
  for (const n of notices) by[n.sourceName] = (by[n.sourceName] || 0) + 1;
  console.log("edu", notices.length, by);
  for (const n of notices.slice(0, 10)) {
    console.log(n.dateISO, n.sourceName, n.title.slice(0, 40), n.url.slice(0, 70));
  }
}

const today = seoulToday();
await buildTeacher(today);
await buildSuhui(today);
await buildEdu(today);
console.log("done", today);
