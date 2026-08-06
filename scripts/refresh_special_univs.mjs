/**
 * 지정 7개 대학 입학 공지(2026-08-01 이후)만 정확히 수집해 univ 보드에 반영.
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_DATE = "2026-08-01";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TARGETS = [
  {
    id: "u188",
    name: "목포해양대",
    homeUrl: "https://www.mmu.ac.kr/admission",
    boardUrl: "https://www.mmu.ac.kr/admission/board/245",
    allow: /mmu\.ac\.kr\/admission\/board\/245\//i,
    fetchMode: "curl",
  },
  {
    id: "u121",
    name: "가톨릭꽃동네대",
    homeUrl: "https://www.kkot.ac.kr/ipsi/main/view/",
    boardUrl:
      "https://www.kkot.ac.kr/ipsi/board/list?boardManagementNo=1143&menuLevel=2&menuNo=120",
    allow: /kkot\.ac\.kr\/ipsi\/board\/read\?.*boardManagementNo=1143/i,
  },
  {
    id: "u003",
    name: "감리교신대",
    homeUrl: "https://www.mtu.ac.kr/mtu/main/main.do?mId=1",
    boardUrl: "https://www.mtu.ac.kr/mtu/board/list.do?mId=516",
    allow: /mtu\.ac\.kr\/mtu\/board\/view\.do\?mId=516/i,
  },
  {
    id: "u219",
    name: "금오공대",
    homeUrl: "https://iphak.kumoh.ac.kr/ipsi/index.do?sso=ok",
    boardUrl: "https://iphak.kumoh.ac.kr/ipsi/sub0601.do",
    allow: /iphak\.kumoh\.ac\.kr\/ipsi\/sub0601\.do/i,
  },
  {
    id: "u066",
    name: "아신대",
    homeUrl: "https://www.acts.ac.kr/admission/design/index.asp",
    boardUrl:
      "https://www.acts.ac.kr/modules/board/bd_list.asp?id=univ_admission&ca_no=2&left=occa1",
    allow: /acts\.ac\.kr\/modules\/board\/bd_view\.asp\?.*id=univ_admission/i,
    encoding: "euc-kr",
  },
  {
    id: "u174",
    name: "예수대",
    homeUrl: "https://jesus.ac.kr/enter/?menu=183",
    boardUrl: "https://jesus.ac.kr/enter/?menu=190",
    allow: /jesus\.ac\.kr\/enter\/\?menu=190/i,
  },
  {
    id: "u157",
    name: "한국전통문화대",
    homeUrl: "https://www.knuh.ac.kr/admission/main.do",
    boardUrl:
      "https://www.knuh.ac.kr/admission/brd/list.do?mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29",
    allow: /knuh\.ac\.kr\/admission\/brd\/view\.do\?.*mnuBaseId=MNU0000210/i,
  },
  {
    id: "u044",
    name: "한예종",
    homeUrl: "https://www.karts.ac.kr/main/appl.do",
    boardUrl:
      "https://www.karts.ac.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000007",
    allow: /karts\.ac\.kr\/cop\/bbs\/selectBoardArticle\.do\?.*bbsId=BBSMSTR_000000000007/i,
    maxPages: 8,
    pageParam: "pageIndex",
  },
  {
    id: "u055",
    name: "동양대(동두천)",
    homeUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    boardUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    allow: /ipsi\.dyu\.ac\.kr\/information\/information_01\/\?.*mod=document.*uid=\d+/i,
    maxPages: 6,
    pageParam: "pageid",
  },
  {
    id: "u227",
    name: "동양대(양주)",
    homeUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    boardUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    allow: /ipsi\.dyu\.ac\.kr\/information\/information_01\/\?.*mod=document.*uid=\d+/i,
    maxPages: 6,
    pageParam: "pageid",
  },
];

function sha20(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 20);
}

function toIso(y, mo, d) {
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (iso < "2020-01-01" || iso > "2035-12-31") return "";
  return iso;
}

function extractIso(text) {
  const matches = [
    ...String(text || "").matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g),
  ];
  if (!matches.length) return "";
  const m = matches[matches.length - 1];
  return toIso(m[1], m[2], m[3]);
}

function seoulToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function decodeEucKr(buf) {
  try {
    return new TextDecoder("euc-kr").decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

async function fetchBuf(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function fetchCurl(url) {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const out = execSync(`${bin} -k -L -s -A "${UA}" "${url}"`, {
    maxBuffer: 25e6,
  });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

async function fetchHtml(cfg) {
  let buf;
  if (cfg.fetchMode === "curl") {
    try {
      buf = fetchCurl(cfg.boardUrl);
    } catch {
      buf = await fetchBuf(cfg.boardUrl);
    }
  } else {
    try {
      buf = await fetchBuf(cfg.boardUrl);
    } catch (e) {
      if (process.platform === "win32") buf = fetchCurl(cfg.boardUrl);
      else throw e;
    }
  }
  if (cfg.encoding === "euc-kr") return decodeEucKr(buf);
  return buf.toString("utf8");
}

function absUrl(base, href) {
  try {
    return new URL(href, base).href.split("#")[0];
  } catch {
    return "";
  }
}

function makeItem(cfg, title, href, dateISO, preview = "") {
  const today = seoulToday();
  title = String(title || "")
    .replace(/\s+/g, " ")
    .replace(/^(새글|N|NEW|공지)\s*/i, "")
    .trim();
  if (!title || title.length < 8) return null;
  if (!dateISO || dateISO < MIN_DATE || dateISO > today) return null;
  if (!href || !cfg.allow.test(href)) return null;
  if (/채용\s*공고|근로장학생|문의드립니다|부탁드립니다|\[답변완료\]/i.test(title)) return null;
  const key = `${cfg.id}|${href}|${title}`;
  return {
    id: sha20(key),
    univId: cfg.id,
    univName: cfg.name,
    title,
    preview: (preview || `${cfg.name} 입학 공지사항 미리보기`).slice(0, 120),
    url: href,
    homeUrl: cfg.homeUrl,
    dateISO,
    dateText: dateISO.replace(/-/g, "."),
  };
}

function parseMmu(html, cfg) {
  const out = [];
  const re =
    /href="([^"]*board\/245[^"]*read\/\d+[^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="date">(\d{4}-\d{2}-\d{2})<\/td>/gi;
  for (const m of html.matchAll(re)) {
    const href = absUrl(cfg.boardUrl, m[1].replace(/\?$/, ""));
    const it = makeItem(cfg, m[2], href, m[3]);
    if (it) out.push(it);
  }
  return out;
}

function parseKkot(html, cfg) {
  const out = [];
  const re =
    /href="((?:https?:\/\/[^"]*)?\/?ipsi\/board\/read\?[^"]*boardManagementNo=1143[^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,240})/gi;
  for (const m of html.matchAll(re)) {
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const dateISO = extractIso(title + " " + m[3].replace(/<[^>]+>/g, " "));
    const href = absUrl("https://www.kkot.ac.kr", m[1].replace(/&amp;/g, "&"));
    const it = makeItem(cfg, title, href, dateISO);
    if (it) out.push(it);
  }
  return out;
}

function parseMtu(html, cfg) {
  const out = [];
  const re =
    /view\.do\?mId=516&(?:amp;)?brdIdx=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?(20\d{2}-\d{2}-\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const href = `https://www.mtu.ac.kr/mtu/board/view.do?mId=516&brdIdx=${m[1]}`;
    const it = makeItem(cfg, title, href, m[3]);
    if (it) out.push(it);
  }
  return out;
}

function parseKumoh(html, cfg) {
  const out = [];
  // 날짜가 <a> 안 mobile-info에 있는 경우가 많음
  const re =
    /href="([^"]*mode=view&(?:amp;)?articleNo=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const block = m[2];
    const dateISO = extractIso(block);
    const title = block
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^공지\s*/, "")
      .replace(/\s*국립금오공과대학교.*$/, "")
      .replace(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2}).*$/, "")
      .trim();
    const href = absUrl(
      "https://iphak.kumoh.ac.kr/ipsi/sub0601.do",
      m[1].replace(/&amp;/g, "&")
    );
    const it = makeItem(cfg, title, href, dateISO);
    if (it) out.push(it);
  }
  return out;
}

function parseActs(html, cfg) {
  const out = [];
  const re =
    /bd_view\.asp\?([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,220}?(20\d{2}-\d{2}-\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const q = m[1].replace(/&amp;/g, "&");
    if (!/id=univ_admission/i.test(q)) continue;
    const title = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*교학지원팀\s*$/, "")
      .trim();
    const href = absUrl("https://www.acts.ac.kr/modules/board/", `bd_view.asp?${q}`);
    const it = makeItem(cfg, title, href, m[3]);
    if (it) out.push(it);
  }
  return out;
}

function parseJesus(html, cfg) {
  const out = [];
  // 날짜 형식: 2026.07.30 (점 구분) — tr 단위로 파싱
  const re =
    /href="(\.\/\?menu=190&(?:amp;)?mode=view&(?:amp;)?no=\d+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,280}?)(?:<\/tr>)/gi;
  for (const m of html.matchAll(re)) {
    const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const dateISO = extractIso(m[3]);
    const href = absUrl(
      "https://jesus.ac.kr/enter/",
      m[1].replace(/&amp;/g, "&").replace(/^\.\//, "")
    );
    const it = makeItem(cfg, title, href, dateISO);
    if (it) out.push(it);
  }
  return out;
}

function parseKnuh(html, cfg) {
  const out = [];
  const re =
    /fnBrdView\('(\d+)'\)"[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?<td class="date"[^>]*>(20\d{2}-\d{2}-\d{2})<\/td>/gi;
  for (const m of html.matchAll(re)) {
    const title = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\[대\s*학\]|\[대학원\]|\[편입학\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const href =
      `https://www.knuh.ac.kr/admission/brd/view.do?mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29&atcSer=${m[1]}`;
    const it = makeItem(cfg, title, href, m[3]);
    if (it) out.push(it);
  }
  return out;
}

function parseKarts(html, cfg) {
  const out = [];
  const re =
    /href="(\/cop\/bbs\/selectBoardArticle\.do\?[^"]*bbsId=BBSMSTR_000000000007[^"]*)"[^>]*title="([^"]+)"[\s\S]{0,1200}?<span class="mont">(20\d{2}\.\d{2}\.\d{2})<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const ntt = (m[1].match(/nttNo=(\d+)/i) || [])[1];
    if (!ntt) continue;
    const href = `https://www.karts.ac.kr/cop/bbs/selectBoardArticle.do?bbsId=BBSMSTR_000000000007&nttNo=${ntt}`;
    const title = m[2].replace(/\s+/g, " ").trim();
    const dateISO = extractIso(m[3]);
    const block = m[0];
    const cateM = block.match(/class="[^"]*ntc_vis[^"]*"[^>]*>([^<]+)</i);
    const cate = cateM ? cateM[1].replace(/<[^>]+>/g, "").trim() : "";
    const preview = cate ? `[${cate}] 한예종 입학 공지` : "한예종 입학 공지사항 미리보기";
    const it = makeItem(cfg, title, href, dateISO, preview);
    if (it) out.push(it);
  }
  return out;
}

function parseDyu(html, cfg) {
  const out = [];
  const re =
    /href="(\/information\/information_01\/\?[^"]*?mod=document(?:&amp;|&#038;|&)uid=(\d+)[^"]*)"[\s\S]*?kboard-default-cut-strings">\s*([^<]+?)\s*<[\s\S]*?kboard-list-date">(20\d{2}\.\d{2}\.\d{2})<\/td>/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://ipsi.dyu.ac.kr/information/information_01/?mod=document&uid=${m[2]}`;
    const title = m[3].replace(/\s+/g, " ").trim();
    const dateISO = extractIso(m[4]);
    const it = makeItem(cfg, title, href, dateISO, `${cfg.name} 입학 공지사항 미리보기`);
    if (it) out.push(it);
  }
  return out;
}

const PARSERS = {
  u188: parseMmu,
  u121: parseKkot,
  u003: parseMtu,
  u219: parseKumoh,
  u066: parseActs,
  u174: parseJesus,
  u157: parseKnuh,
  u044: parseKarts,
  u055: parseDyu,
  u227: parseDyu,
};

function loadPayload() {
  const jsPath = path.join(ROOT, "univ-board-data.js");
  const raw = fs.readFileSync(jsPath, "utf8");
  const json = raw.split("=").slice(1).join("=").trim().replace(/;$/, "");
  return JSON.parse(json);
}

function savePayload(payload) {
  const jsPath = path.join(ROOT, "univ-board-data.js");
  const jsonPath = path.join(ROOT, "data", "univ-notices.json");
  const sourcesPath = path.join(ROOT, "univ-sources.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(
    jsPath,
    "window.UNIV_BOARD_DATA=" + JSON.stringify(payload) + ";\n",
    "utf8"
  );
  fs.writeFileSync(sourcesPath, JSON.stringify(payload.sources || [], null, 2), "utf8");
}

function updateSources(sources) {
  const byId = new Map(TARGETS.map((t) => [t.id, t]));
  return (sources || []).map((s) => {
    const t = byId.get(s.id);
    if (!t) return s;
    return { ...s, name: t.name, homeUrl: t.homeUrl, boardUrl: t.boardUrl };
  });
}

async function main() {
  const payload = loadPayload();
  payload.sources = updateSources(payload.sources);
  const today = seoulToday();
  const byId = new Map(TARGETS.map((t) => [t.id, t]));
  const notices = [];

  // 지정 대학이 아닌 공지는 그대로 유지
  for (const n of payload.notices || []) {
    if (!byId.has(n.univId)) notices.push(n);
  }

  for (const cfg of TARGETS) {
    const prev = (payload.notices || []).filter((n) => n.univId === cfg.id);
    try {
      const parser = PARSERS[cfg.id];
      let items = [];
      if (cfg.maxPages) {
        const maxPages = cfg.maxPages || 5;
        const pageParam = cfg.pageParam || "pageIndex";
        for (let page = 1; page <= maxPages; page++) {
          let pageUrl;
          if (pageParam === "pageid") {
            pageUrl = `${cfg.boardUrl.replace(/\/?$/, "/")}?pageid=${page}`;
          } else {
            pageUrl = cfg.boardUrl.includes("?")
              ? `${cfg.boardUrl}&${pageParam}=${page}`
              : `${cfg.boardUrl}?${pageParam}=${page}`;
          }
          const html = await fetchHtml({ ...cfg, boardUrl: pageUrl });
          const pageItems = parser(html, cfg);
          if (!pageItems.length) break;
          items.push(...pageItems);
          const oldest = pageItems.map((it) => it.dateISO).sort()[0] || "";
          if (oldest && oldest < MIN_DATE) break;
        }
      } else {
        const html = await fetchHtml(cfg);
        items = parser(html, cfg);
      }
      const map = new Map();
      for (const it of items) map.set(`${it.url}|${it.title}`, it);
      items = [...map.values()]
        .filter((it) => it.dateISO >= MIN_DATE && it.dateISO <= today)
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
        .slice(0, cfg.id === "u044" ? 20 : 8);

      if (items.length) {
        console.log(`${cfg.name}: ${items.length}건 (>=${MIN_DATE})`);
        for (const it of items.slice(0, 6)) {
          console.log(" ", it.dateISO, it.title.slice(0, 70));
          console.log("   ", it.url);
        }
        notices.push(...items);
      } else {
        // 신규 수집 0건이면 허용 URL의 이전 글만 유지 (빈 결과로 전체 삭제 방지)
        const kept = prev.filter((n) => cfg.allow.test(String(n.url || "")));
        console.log(`${cfg.name}: 0건 → 이전 허용 글 ${kept.length}건 유지`);
        notices.push(...kept);
      }
    } catch (e) {
      const kept = prev.filter((n) => cfg.allow.test(String(n.url || "")));
      console.error(`${cfg.name} FAIL`, e.message || e, `→ 이전 ${kept.length}건 유지`);
      notices.push(...kept);
    }
  }

  payload.notices = notices.sort((a, b) =>
    `${b.dateISO}|${b.title}`.localeCompare(`${a.dateISO}|${a.title}`)
  );
  payload.updatedAt = new Date().toISOString();
  payload.checkedAt = payload.updatedAt;
  savePayload(payload);
  console.log(`done notices=${payload.notices.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
