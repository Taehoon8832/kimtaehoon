/**
 * 전국 4년제 입학처 공지 고속 수집 → univ-board-data.js / data/univ-notices.json
 * - 동적 minDate (입시 시즌 8/1 자동 롤)
 * - 사관·지정대학 전용 파서 + 일반 HTML 파서
 * - 병렬 fetch, 빈 결과로 정상 데이터를 덮지 않음
 */
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_PER = 6;
const CONCURRENCY = Number(process.env.UNIV_CONCURRENCY || 20);
const USE_JINA = !["0", "false", "False"].includes(String(process.env.USE_JINA || "1"));
const FETCH_TIMEOUT_MS = Number(process.env.UNIV_FETCH_TIMEOUT_MS || 14000);

const BAD_TITLE =
  /(채용\s*공고|직원\s*채용|근로장학생|학자금대출|문의\s*\(\d|공지사항\s*더보기|^대학\s*입학\s*문의|OMR|문서등록|예비소집\s*\/|졸업\s*\(?예정\)?자\s*안내)/i;
const TITLE_HINT =
  /(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|설명회|시행|모의|상담|접수|결과)/;
const NOTICE_HREF =
  /(notice|bbs|board|article|artcl|공지|소식|news|view|Board|ipsi|admission|ntt|brd)/i;
const JUNK =
  /(var\s|function\s|document\.|<\w+|javascript:|bbsrg|사이트맵|로그인|개인정보|이용약관|웹접근성)/i;
const SKIP = /^(더보기|more|이전|다음|목록|home|로그인|전체|공지사항|공지|뉴스|새글|N|NEW)$/i;
const BROKEN = /\/admission\/html\/notice\/notice\.asp$|error404|404\.html/i;
const COMMON_PATHS = [
  "/notice",
  "/bbs/notice",
  "/board/notice",
  "/admission/notice",
  "/ipsi/notice",
  "/enter/notice",
];

/** 지정 대학 — board/allow/parser */
const SPECIAL = {
  u188: {
    homeUrl: "https://www.mmu.ac.kr/admission",
    boardUrl: "https://www.mmu.ac.kr/admission/board/245",
    allow: /mmu\.ac\.kr\/admission\/board\/245\//i,
    curl: true,
  },
  u121: {
    homeUrl: "https://www.kkot.ac.kr/ipsi/main/view/",
    boardUrl:
      "https://www.kkot.ac.kr/ipsi/board/list?boardManagementNo=1143&menuLevel=2&menuNo=120",
    allow: /kkot\.ac\.kr\/ipsi\/board\/read\?.*boardManagementNo=1143/i,
  },
  u003: {
    homeUrl: "https://www.mtu.ac.kr/mtu/main/main.do?mId=1",
    boardUrl: "https://www.mtu.ac.kr/mtu/board/list.do?mId=516",
    allow: /mtu\.ac\.kr\/mtu\/board\/view\.do\?mId=516/i,
  },
  u219: {
    homeUrl: "https://iphak.kumoh.ac.kr/ipsi/index.do?sso=ok",
    boardUrl: "https://iphak.kumoh.ac.kr/ipsi/sub0601.do",
    allow: /iphak\.kumoh\.ac\.kr\/ipsi\/sub0601\.do/i,
  },
  u066: {
    homeUrl: "https://www.acts.ac.kr/admission/design/index.asp",
    boardUrl:
      "https://www.acts.ac.kr/modules/board/bd_list.asp?id=univ_admission&ca_no=2&left=occa1",
    allow: /acts\.ac\.kr\/modules\/board\/bd_view\.asp\?.*id=univ_admission/i,
    encoding: "euc-kr",
  },
  u174: {
    homeUrl: "https://jesus.ac.kr/enter/?menu=183",
    boardUrl: "https://jesus.ac.kr/enter/?menu=190",
    allow: /jesus\.ac\.kr\/enter\/\?menu=190/i,
  },
  u157: {
    homeUrl: "https://www.knuh.ac.kr/admission/main.do",
    boardUrl:
      "https://www.knuh.ac.kr/admission/brd/list.do?mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29",
    allow: /knuh\.ac\.kr\/admission\/brd\/view\.do\?.*mnuBaseId=MNU0000210/i,
  },
  u044: {
    homeUrl: "https://www.karts.ac.kr/main/appl.do",
    boardUrl:
      "https://www.karts.ac.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000007",
    allow: /karts\.ac\.kr\/cop\/bbs\/selectBoardArticle\.do\?.*bbsId=BBSMSTR_000000000007/i,
    maxPages: 6,
    pageParam: "pageIndex",
    maxPer: 20,
  },
  u055: {
    homeUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    boardUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    allow: /ipsi\.dyu\.ac\.kr\/information\/information_01\/\?.*mod=document.*uid=\d+/i,
    maxPages: 5,
    pageParam: "pageid",
    maxPer: 20,
  },
  u227: {
    homeUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    boardUrl: "https://ipsi.dyu.ac.kr/information/information_01/",
    allow: /ipsi\.dyu\.ac\.kr\/information\/information_01\/\?.*mod=document.*uid=\d+/i,
    maxPages: 5,
    pageParam: "pageid",
    maxPer: 20,
  },
  u032: {
    homeUrl: "https://www.kma.ac.kr:461/",
    boardUrl: "https://www.kma.ac.kr:461/kma/2100/subview.do",
    allow: /kma\.ac\.kr(?::\d+)?\/bbs\/kma\/160\/\d+\/artclView\.do/i,
    k2Path: "/bbs/kma/160/",
  },
  u245: {
    homeUrl: "https://www.navy.ac.kr:4443/sites/iphak/index.do",
    boardUrl: "https://www.navy.ac.kr:4443/iphak/1630/subview.do",
    allow: /navy\.ac\.kr(?::\d+)?\/bbs\/iphak\/142\/\d+\/artclView\.do/i,
    k2Path: "/bbs/iphak/142/",
  },
  u232: {
    homeUrl: "https://www.kaay.mil.kr:458/kaay/1142/subview.do",
    boardUrl: "https://www.kaay.mil.kr:458/kaay/1159/subview.do",
    allow: /kaay\.mil\.kr(?::\d+)?\/bbs\/kaay\/152\/\d+\/artclView\.do/i,
    k2Path: "/bbs/kaay/152/",
  },
  u123: {
    homeUrl: "https://rokaf.airforce.mil.kr/sites/afaadmission/index.do",
    boardUrl: "https://rokaf.airforce.mil.kr/afaadmission/7161/subview.do",
    allow: /rokaf\.airforce\.mil\.kr\/bbs\/afaadmission\/2089\/\d+\/artclView\.do/i,
    parser: "afa",
  },
  u109: {
    homeUrl: "https://tapply.tonc.net/kafna/",
    boardUrl: "https://tapply.tonc.net/kafna/?doc=bbs/board.php&bo_table=notice",
    allow: /tapply\.tonc\.net\/kafna\/\?doc=bbs\/board\.php&.*bo_table=notice.*wr_id=\d+/i,
    parser: "kafna",
  },
  u173: {
    // 국립군산대 입학처 전체 공지 — 작성일(td)만 사용 (날짜 오염 방지)
    homeUrl: "https://www.kunsan.ac.kr/iphak/index.kunsan",
    boardUrl:
      "https://www.kunsan.ac.kr/iphak/board/list.kunsan?boardId=BBS_0000041&menuCd=DOM_000001218001000000&paging=ok&startPage=1",
    allow: /kunsan\.ac\.kr\/iphak\/board\/view\.kunsan\?.*boardId=BBS_0000041.*dataSid=\d+/i,
    parser: "kunsan",
  },
  // —— 주요 수도권 대학 (입학처 전체 공지) ——
  u031: {
    homeUrl: "https://admission.yonsei.ac.kr/seoul/admission/html/main/main.asp",
    boardUrl: "https://admission.yonsei.ac.kr/seoul/admission/html/counsel/notice.asp",
    allow: /admission\.yonsei\.ac\.kr\/seoul\/admission\/html\/counsel\/noticeView\.asp\?.*BBS_NO=\d+/i,
    parser: "yonsei",
    encoding: "euc-kr",
    maxPer: 30,
  },
  u042: {
    homeUrl: "https://go.hanyang.ac.kr/gate.do",
    boardUrl: "https://go.hanyang.ac.kr/web/notice/notice_list.do?m_type=IPSI",
    boards: [
      "https://go.hanyang.ac.kr/web/notice/notice_list.do?m_type=IPSI",
      "https://go.hanyang.ac.kr/web/notice/notice_list.do?m_type=SUSI",
      "https://go.hanyang.ac.kr/web/notice/notice_list.do?m_type=COMMON",
      "https://go.hanyang.ac.kr/web/notice/notice_list.do?m_type=JEOEGUK",
    ],
    allow: /go\.hanyang\.ac\.kr\/web\/notice\/notice_view\.do\?.*bn=\d+/i,
    parser: "hanyang",
    maxPer: 40,
  },
  u030: {
    homeUrl: "https://iphak.ssu.ac.kr/",
    boardUrl: "https://iphak.ssu.ac.kr/board/notice_list.asp?page=1&page_no=1_1_1",
    allow: /iphak\.ssu\.ac\.kr\/board\/notice_view\.asp\?.*number=\d+/i,
    parser: "ssu",
    encoding: "euc-kr",
    maxPer: 30,
  },
  u009: {
    homeUrl: "https://admission.kookmin.ac.kr/main.php",
    boardUrl: "https://admission.kookmin.ac.kr/nonschedule/notice.php",
    allow: /admission\.kookmin\.ac\.kr\/nonschedule\/notice\.php\?.*ctype=view.*no=\d+/i,
    parser: "kookmin",
    maxPer: 30,
  },
  u033: {
    homeUrl: "https://admission.ewha.ac.kr/admission/html/main/intro.asp",
    boardUrl: "https://admission.ewha.ac.kr/admission/html/ewharo/notice.asp",
    allow: /admission\.ewha\.ac\.kr\/admission\/html\/ewharo\/noticeView\.asp\?.*idx=\d+/i,
    parser: "ewha",
    encoding: "euc-kr",
    maxPer: 30,
  },
  u029: {
    homeUrl: "https://admission.sookmyung.ac.kr/admission/html/main/main.asp",
    boardUrl: "https://admission.sookmyung.ac.kr/admission/html/counsel/notice.asp",
    allow: /admission\.sookmyung\.ac\.kr\/admission\/html\/counsel\/noticeView\.asp\?.*p_board_idx=\d+/i,
    parser: "sook",
    encoding: "euc-kr",
    maxPer: 30,
  },
  u085: {
    homeUrl: "https://goerica.hanyang.ac.kr/admission/intro.asp",
    boardUrl: "https://goerica.hanyang.ac.kr/admission/html/counsel/all_notice.asp",
    allow: /goerica\.hanyang\.ac\.kr\/admission\/html\/counsel\/all_notice_view\.asp\?.*idx=\d+/i,
    parser: "erica",
    encoding: "euc-kr",
    maxPer: 30,
  },
};

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

/** 입시 시즌 창: 매년 8/1 ~ 다음 해 7/31 */
function admissionMinDate(today = seoulToday()) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m >= 8 ? `${y}-08-01` : `${y - 1}-08-01`;
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
  // 26.08.07 / 26-08-01 / 26/08/07
  const yy = [
    ...String(text || "").matchAll(/(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/g),
  ];
  if (!yy.length) return "";
  const m = yy[yy.length - 1];
  let y = Number(m[1]);
  // 학년도(26,27…) 오탐 방지: 월이 1~12일 때만
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  y += y < 70 ? 2000 : 1900;
  return toIso(y, mo, d);
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
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
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

function is404(html) {
  const head = String(html || "").slice(0, 2800);
  return /HTTP 오류 404|404\.0 - Not Found|error404/i.test(head);
}

function repairUrl(u) {
  return String(u || "").replace(
    /https?:\/\/admission\.sookmyung\.ac\.kr\/counsel\//i,
    "https://admission.sookmyung.ac.kr/admission/html/counsel/"
  );
}

function isWeakUrl(absu, pageUrl) {
  if (!absu || !/^https?:\/\//i.test(absu)) return true;
  if (/rokaf\.airforce\.mil\.kr/i.test(absu)) {
    if (/\/bbs\/afaadmission\/1041\//i.test(absu)) return true;
    return !/\/bbs\/afaadmission\/2089\/\d+\/artclView\.do/i.test(absu);
  }
  if (/kma\.ac\.kr/i.test(absu)) return !/\/bbs\/kma\/160\/\d+\/artclView\.do/i.test(absu);
  if (/navy\.ac\.kr/i.test(absu)) return !/\/bbs\/iphak\/142\/\d+\/artclView\.do/i.test(absu);
  if (/kaay\.mil\.kr/i.test(absu)) return !/\/bbs\/kaay\/152\/\d+\/artclView\.do/i.test(absu);
  if (/tapply\.tonc\.net\/kafna/i.test(absu)) return !/bo_table=notice.*wr_id=\d+/i.test(absu);
  if (BROKEN.test(absu) || /javascript:|void\(0\)/i.test(absu)) return true;
  const low = absu.toLowerCase().split("#")[0];
  const hasId =
    /[?&](id|no|seq|idx|bbsidx|ntt|article|artcl|brdIdx|dataSid|uid|num|number|p_board_idx|wr_id|nttSn|bn|BBS_NO)=/i.test(
      absu
    ) || /\/\d+\/artclView\.do/i.test(absu) || /\/read\/\d+/i.test(absu);
  if (hasId) return false;
  if (/\/(main|index|intro)(\.(asp|do|php|html?))?\/?$/i.test(low)) return true;
  return false;
}

function makeItem(src, titleRaw, preview, absu, dateISO, pageUrl, minDate) {
  const today = seoulToday();
  let title = stripTags(titleRaw)
    .replace(/-->/g, " ")
    .replace(/작성일\s*[:：]?\s*/gi, " ")
    .replace(/조회수\s*[:：]?\s*[\d,]+/gi, " ")
    .replace(/^(새글|N|NEW|공지)\s*/i, "")
    .replace(/^\[(?:공통|수시|정시|재외국민|편입학|수시모집|정시모집|International Students|고교대학연계|시간제|순수외국인)\]\s*/i, "")
    .replace(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g, " ")
    .replace(/[|｜ㅣ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!title || title.length < 8 || title.length > 140) return null;
  if (SKIP.test(title) || JUNK.test(title)) return null;
  if (BAD_TITLE.test(title)) {
    if (!(["u032", "u245", "u123", "u232", "u109"].includes(src.id) && title.includes("분실물"))) {
      return null;
    }
  }
  if ((title.match(/[가-힣]/g) || []).length < 4) return null;
  if (!dateISO || dateISO < minDate || dateISO > today) return null;
  // 시즌 초반(minDate+30일) 이후는 입시 키워드가 있는 글만
  const [sy, sm, sd] = minDate.split("-").map(Number);
  const soft = new Date(Date.UTC(sy, sm - 1, sd + 30));
  const softEnd = soft.toISOString().slice(0, 10);
  if (dateISO > softEnd && !TITLE_HINT.test(title)) return null;
  absu = repairUrl(absu);
  if (!absu.startsWith("http") || BROKEN.test(absu) || isWeakUrl(absu, pageUrl || absu)) return null;
  let prev = stripTags(preview || "");
  if (JUNK.test(prev) || (prev.match(/[가-힣]/g) || []).length < 2) {
    prev = `${src.name} 입학 공지사항 미리보기`;
  }
  const key = `${src.id}|${absu}|${title}`;
  return {
    id: sha20(key),
    univId: src.id,
    univName: src.name,
    title,
    preview: prev.slice(0, 120),
    url: absu,
    homeUrl: src.homeUrl || "",
    dateISO,
    dateText: dateISO.replace(/-/g, "."),
  };
}

async function fetchTextOnce(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    if (opts.curl) {
      try {
        const bin = process.platform === "win32" ? "curl.exe" : "curl";
        const out = execSync(`${bin} -k -L -s --max-time 20 -A "${UA}" "${url}"`, {
          maxBuffer: 20e6,
        });
        return Buffer.isBuffer(out) ? out.toString("utf8") : String(out);
      } catch {
        /* fall through */
      }
    }
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`http_${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const utf8 = buf.toString("utf8");
    const metaEuc = /charset\s*=\s*['"]?euc-kr/i.test(utf8.slice(0, 2500));
    const wantEuc = opts.encoding === "euc-kr" || metaEuc;
    if (wantEuc) {
      try {
        const euc = new TextDecoder("euc-kr").decode(buf);
        const eucHangul = (euc.match(/[가-힣]/g) || []).length;
        const utfHangul = (utf8.match(/[가-힣]/g) || []).length;
        // meta가 euc-kr이어도 실제 UTF-8인 페이지가 있어 한글 밀도로 선택
        if (eucHangul >= utfHangul && eucHangul >= 8) return euc;
      } catch {
        /* keep utf8 */
      }
    }
    return utf8;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, opts = {}) {
  try {
    return await fetchTextOnce(url, opts);
  } catch {
    // 1회 재시도
    await new Promise((r) => setTimeout(r, 250));
    return fetchTextOnce(url, opts);
  }
}

async function fetchJina(url) {
  try {
    return await fetchText("https://r.jina.ai/" + url, {});
  } catch {
    return "";
  }
}

function parseK2(html, src, cfg, minDate) {
  const out = [];
  const esc = String(cfg.k2Path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `href\\s*=\\s*["']([^"']*?${esc}\\d+/artclView\\.do)["'][\\s\\S]{0,1800}?<strong>([\\s\\S]{0,240}?)</strong>[\\s\\S]{0,1800}?(20\\d{2}\\s*[.\\-/]\\s*\\d{1,2}\\s*[.\\-/]\\s*\\d{1,2})`,
    "gi"
  );
  for (const m of html.matchAll(re)) {
    const href = absUrl(cfg.boardUrl, m[1]);
    const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
    if (it && (!cfg.allow || cfg.allow.test(it.url))) out.push(it);
  }
  return out;
}

function parseAfa(html, src, cfg, minDate) {
  const out = [];
  const re =
    /<a\s+href\s*=\s*["']([^"']*?\/bbs\/afaadmission\/2089\/\d+\/artclView\.do)["'][^>]*class="[^"]*artclLinkView[^"]*"[\s\S]*?<strong>([\s\S]*?)<\/strong>[\s\S]*?class="_artclregDate"[\s\S]*?<dd>\s*([^<]+?)\s*<\/dd>/gi;
  for (const m of html.matchAll(re)) {
    const href = absUrl(cfg.boardUrl, m[1]);
    const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
    if (it) out.push(it);
  }
  if (!out.length) return parseK2(html, src, { ...cfg, k2Path: "/bbs/afaadmission/2089/" }, minDate);
  return out;
}

function parseKafna(html, src, cfg, minDate) {
  const out = [];
  const re =
    /href=['"](\.\/\?doc=bbs\/board\.php&bo_table=notice[^'"]*?wr_id=(\d+)[^'"]*)['"][\s\S]{0,200}?<b>([\s\S]{0,200}?)<\/b>[\s\S]{0,400}?(?<!\d)(\d{2}-\d{2}-\d{2})(?!\d)/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://tapply.tonc.net/kafna/?doc=bbs/board.php&bo_table=notice&wr_id=${m[2]}`;
    const it = makeItem(src, m[3], "", href, extractIso(m[4]), cfg.boardUrl, minDate);
    if (it) out.push(it);
  }
  return out;
}

function parseKunsan(html, src, cfg, minDate) {
  const out = [];
  // 목록 행: view.kunsan?...dataSid=N ... 제목 ... 작성일 YYYY-MM-DD
  const re =
    /href="([^"]*\/iphak\/board\/view\.kunsan\?[^"]*boardId=BBS_0000041[^"]*dataSid=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?(20\d{2}-\d{2}-\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const sid = m[2];
    const title = stripTags(m[3]) || stripTags(m[1]);
    const dateISO = m[4];
    const href =
      `https://www.kunsan.ac.kr/iphak/board/view.kunsan?boardId=BBS_0000041` +
      `&menuCd=DOM_000001218001000000&paging=ok&startPage=1&dataSid=${sid}`;
    const it = makeItem(src, title, "", href, dateISO, cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseYonsei(html, src, cfg, minDate) {
  const out = [];
  const re =
    /href="([^"]*noticeView\.asp\?[^"]*BBS_NO=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const block = m[3];
    const dateISO = extractIso(block);
    const title = stripTags(block)
      .replace(/작성일\s*:\s*20\d{2}[./-]\d{1,2}[./-]\d{1,2}.*/i, "")
      .replace(/조회수\s*:?\s*[\d,]+.*/i, "")
      .replace(/\|/g, " ")
      .trim();
    const href = absUrl(
      "https://admission.yonsei.ac.kr/seoul/admission/html/counsel/",
      `noticeView.asp?BBS_NO=${m[2]}`
    );
    const it = makeItem(src, title, "", href, dateISO, cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseHanyang(html, src, cfg, minDate) {
  const out = [];
  const re =
    /js_encode_view\('notice_view\.do\?bn=(\d+)&m_type=([A-Z]+)&nPage=\d+'\)[\s\S]{0,700}?<strong>([\s\S]*?)<\/strong>[\s\S]{0,200}?<span class="date">([^<]+)<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://go.hanyang.ac.kr/web/notice/notice_view.do?bn=${m[1]}&m_type=${m[2]}`;
    const title = stripTags(m[3]).replace(/첨부파일/g, "").trim();
    const it = makeItem(src, title, "", href, extractIso(m[4]), cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseSsu(html, src, cfg, minDate) {
  const out = [];
  const re =
    /href="([^"]*notice_view\.asp\?number=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,280}?(20\d{2}\.\d{2}\.\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://iphak.ssu.ac.kr/board/notice_view.asp?number=${m[2]}&page_no=1_1_1&page=1`;
    let title = stripTags(m[3]);
    // 목록 셀에 "[공통] 제목 [공통] 제목"처럼 중복 렌더되는 경우 정리
    const cat =
      "공통|수시|정시|재외국민|편입학|International Students|고교대학연계|시간제|순수외국인|기타";
    title = title.replace(new RegExp(`^\\[(?:${cat})\\]\\s*`, "i"), "").trim();
    title = title.replace(new RegExp(`\\s*\\[(?:${cat})\\][\\s\\S]*$`, "i"), "").trim();
    const half = Math.floor(title.length / 2);
    if (half > 12 && title.slice(0, half).replace(/\s+/g, "") === title.slice(half).replace(/\s+/g, "")) {
      title = title.slice(0, half).trim();
    }
    const it = makeItem(src, title, "", href, extractIso(m[4]), cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseKookmin(html, src, cfg, minDate) {
  const out = [];
  const re =
    /href="(\?ctype=view[^"]*?no=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,220}?작성일\s*:\s*(20\d{2}-\d{2}-\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://admission.kookmin.ac.kr/nonschedule/notice.php?ctype=view&no=${m[2]}`;
    const it = makeItem(src, m[3], "", href, m[4], cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseEwha(html, src, cfg, minDate) {
  const out = [];
  const re =
    /onclick="viewData\('(\d+)'\);\s*return false;"[\s\S]*?<p class="title">([\s\S]*?)<\/p>[\s\S]*?<span class="date">(20\d{2}\.\d{2}\.\d{2})<\/span>/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://admission.ewha.ac.kr/admission/html/ewharo/noticeView.asp?idx=${m[1]}`;
    const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseSook(html, src, cfg, minDate) {
  const out = [];
  const re =
    /viewBoardProcess\('(\d+)'\)[\s\S]{0,200}?class="subject">([\s\S]*?)<\/span>[\s\S]{0,280}?(20\d{2}\.\d{2}\.\d{2})/gi;
  for (const m of html.matchAll(re)) {
    const href = `https://admission.sookmyung.ac.kr/admission/html/counsel/noticeView.asp?p_board_idx=${m[1]}`;
    const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseErica(html, src, cfg, minDate) {
  const out = [];
  const seen = new Set();
  const re =
    /viewData\('(\d+)'\)[\s\S]{0,900}?table_title[\s\S]{0,400}?<a[^>]*>([\s\S]*?)<\/a>[\s\S]{0,500}?table_date[^>]*>\s*(20\d{2}\.\d{2}\.\d{2})/gi;
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const href = `https://goerica.hanyang.ac.kr/admission/html/counsel/all_notice_view.asp?idx=${m[1]}`;
    const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
    if (it && cfg.allow.test(it.url)) out.push(it);
  }
  return out;
}

function parseSpecial(html, src, cfg, minDate) {
  if (cfg.parser === "afa") return parseAfa(html, src, cfg, minDate);
  if (cfg.parser === "kafna") return parseKafna(html, src, cfg, minDate);
  if (cfg.parser === "kunsan") return parseKunsan(html, src, cfg, minDate);
  if (cfg.parser === "yonsei") return parseYonsei(html, src, cfg, minDate);
  if (cfg.parser === "hanyang") return parseHanyang(html, src, cfg, minDate);
  if (cfg.parser === "ssu") return parseSsu(html, src, cfg, minDate);
  if (cfg.parser === "kookmin") return parseKookmin(html, src, cfg, minDate);
  if (cfg.parser === "ewha") return parseEwha(html, src, cfg, minDate);
  if (cfg.parser === "sook") return parseSook(html, src, cfg, minDate);
  if (cfg.parser === "erica") return parseErica(html, src, cfg, minDate);
  if (cfg.k2Path) return parseK2(html, src, cfg, minDate);

  const out = [];
  const uid = src.id;
  if (uid === "u188") {
    const re =
      /href="([^"]*board\/245[^"]*read\/\d+[^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<td class="date">(\d{4}-\d{2}-\d{2})<\/td>/gi;
    for (const m of html.matchAll(re)) {
      const href = absUrl(cfg.boardUrl, m[1].replace(/\?$/, ""));
      const it = makeItem(src, m[2], "", href, m[3], cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u121") {
    const re =
      /href="((?:https?:\/\/[^"]*)?\/?ipsi\/board\/read\?[^"]*boardManagementNo=1143[^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,240})/gi;
    for (const m of html.matchAll(re)) {
      const title = stripTags(m[2]);
      const dateISO = extractIso(title + " " + stripTags(m[3]));
      const href = absUrl("https://www.kkot.ac.kr", m[1].replace(/&amp;/g, "&"));
      const it = makeItem(src, title, "", href, dateISO, cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u003") {
    const re =
      /view\.do\?mId=516&(?:amp;)?brdIdx=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?(20\d{2}-\d{2}-\d{2})/gi;
    for (const m of html.matchAll(re)) {
      const href = `https://www.mtu.ac.kr/mtu/board/view.do?mId=516&brdIdx=${m[1]}`;
      const it = makeItem(src, m[2], "", href, m[3], cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u219") {
    const re = /href="([^"]*mode=view&(?:amp;)?articleNo=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(re)) {
      const block = m[2];
      const dateISO = extractIso(block);
      const title = stripTags(block)
        .replace(/^공지\s*/, "")
        .replace(/\s*국립금오공과대학교.*$/, "")
        .replace(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2}).*$/, "")
        .trim();
      const href = absUrl("https://iphak.kumoh.ac.kr/ipsi/sub0601.do", m[1].replace(/&amp;/g, "&"));
      const it = makeItem(src, title, "", href, dateISO, cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u066") {
    const re =
      /bd_view\.asp\?([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,220}?(20\d{2}-\d{2}-\d{2})/gi;
    for (const m of html.matchAll(re)) {
      const q = m[1].replace(/&amp;/g, "&");
      if (!/id=univ_admission/i.test(q)) continue;
      const href = absUrl("https://www.acts.ac.kr/modules/board/", `bd_view.asp?${q}`);
      const it = makeItem(src, m[2], "", href, m[3], cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u174") {
    const re =
      /href="(\.\/\?menu=190&(?:amp;)?mode=view&(?:amp;)?no=\d+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,280}?)(?:<\/tr>)/gi;
    for (const m of html.matchAll(re)) {
      const href = absUrl(
        "https://jesus.ac.kr/enter/",
        m[1].replace(/&amp;/g, "&").replace(/^\.\//, "")
      );
      const it = makeItem(src, m[2], "", href, extractIso(m[3]), cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u157") {
    const re =
      /fnBrdView\('(\d+)'\)"[\s\S]*?>([\s\S]*?)<\/a>[\s\S]*?<td class="date"[^>]*>(20\d{2}-\d{2}-\d{2})<\/td>/gi;
    for (const m of html.matchAll(re)) {
      const href = `https://www.knuh.ac.kr/admission/brd/view.do?mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29&atcSer=${m[1]}`;
      const title = stripTags(m[2]).replace(/\[대\s*학\]|\[대학원\]|\[편입학\]/g, " ").trim();
      const it = makeItem(src, title, "", href, m[3], cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u044") {
    const re =
      /href="(\/cop\/bbs\/selectBoardArticle\.do\?[^"]*bbsId=BBSMSTR_000000000007[^"]*)"[^>]*title="([^"]+)"[\s\S]{0,1200}?<span class="mont">(20\d{2}\.\d{2}\.\d{2})<\/span>/gi;
    for (const m of html.matchAll(re)) {
      const ntt = (m[1].match(/nttNo=(\d+)/i) || [])[1];
      if (!ntt) continue;
      const href = `https://www.karts.ac.kr/cop/bbs/selectBoardArticle.do?bbsId=BBSMSTR_000000000007&nttNo=${ntt}`;
      const it = makeItem(src, m[2], "한예종 입학 공지사항 미리보기", href, extractIso(m[3]), cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  } else if (uid === "u055" || uid === "u227") {
    const re =
      /href="(\/information\/information_01\/\?[^"]*?mod=document(?:&amp;|&#038;|&)uid=(\d+)[^"]*)"[\s\S]*?kboard-default-cut-strings">\s*([^<]+?)\s*<[\s\S]*?kboard-list-date">(20\d{2}\.\d{2}\.\d{2})<\/td>/gi;
    for (const m of html.matchAll(re)) {
      const href = `https://ipsi.dyu.ac.kr/information/information_01/?mod=document&uid=${m[2]}`;
      const it = makeItem(src, m[3], "", href, extractIso(m[4]), cfg.boardUrl, minDate);
      if (it && cfg.allow.test(it.url)) out.push(it);
    }
  }
  return out;
}

function parseHtml(html, pageUrl, src, minDate) {
  if (!html || is404(html)) return [];
  if (/rokaf\.airforce\.mil\.kr/i.test(pageUrl) && (/\/7161\//.test(pageUrl) || /afaadmission/.test(pageUrl))) {
    const afa = parseAfa(html, src, { boardUrl: pageUrl }, minDate);
    if (afa.length) return afa.slice(0, MAX_PER);
  }
  const items = [];
  const re = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]{0,420})/gi;
  for (const m of html.matchAll(re)) {
    const href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) continue;
    const title = stripTags(m[2]);
    const tail = stripTags(m[3]);
    if (!(NOTICE_HREF.test(href) || TITLE_HINT.test(title))) continue;
    const dateISO = extractIso(title) || extractIso(tail);
    if (!dateISO) continue;
    const absu = repairUrl(absUrl(pageUrl, href));
    const it = makeItem(src, title, tail, absu, dateISO, pageUrl, minDate);
    if (it) items.push(it);
  }
  const map = new Map(items.map((it) => [`${it.url}|${it.title}`, it]));
  return [...map.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, MAX_PER);
}

function parseMarkdown(md, src, minDate) {
  const items = [];
  const re =
    /\[([^\]]{6,180})\]\((https?:\/\/[^)\s]+)\)([\s\S]{0,160}?)(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g;
  for (const m of md.matchAll(re)) {
    const title = stripTags(m[1]);
    const url = m[2].split("#")[0];
    const dateISO = extractIso(title) || toIso(m[4], m[5], m[6]);
    if (!(NOTICE_HREF.test(url) || TITLE_HINT.test(title))) continue;
    const it = makeItem(src, title, stripTags(m[3]), url, dateISO, url, minDate);
    if (it) items.push(it);
  }
  const map = new Map(items.map((it) => [`${it.url}|${it.title}`, it]));
  return [...map.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)).slice(0, MAX_PER);
}

function candidateUrls(src) {
  const urls = [];
  for (const u of [src.boardUrl, src.homeUrl]) {
    const s = String(u || "").trim();
    if (s && !BROKEN.test(s) && !urls.includes(s)) urls.push(s);
  }
  const home = String(src.homeUrl || "").trim();
  if (home && !BROKEN.test(home)) {
    try {
      const base = new URL(home);
      const origin = `${base.protocol}//${base.host}`;
      for (const p of COMMON_PATHS) {
        const u = origin + p;
        if (!urls.includes(u)) urls.push(u);
      }
    } catch {
      /* ignore */
    }
  }
  return urls.slice(0, 4);
}

function pagedUrl(board, page, pageParam) {
  if (pageParam === "pageid") return `${board.replace(/\/?$/, "/") }?pageid=${page}`;
  return board.includes("?") ? `${board}&${pageParam}=${page}` : `${board}?${pageParam}=${page}`;
}

async function scrapeSpecial(src, cfg, minDate) {
  const limit = cfg.maxPer || MAX_PER;
  const boards = Array.isArray(cfg.boards) && cfg.boards.length ? cfg.boards : [cfg.boardUrl];
  let items = [];
  for (const board of boards) {
    const local = { ...cfg, boardUrl: board };
    if (cfg.maxPages) {
      for (let page = 1; page <= cfg.maxPages; page++) {
        const pageUrl = pagedUrl(board, page, cfg.pageParam || "pageIndex");
        const html = await fetchText(pageUrl, { curl: cfg.curl, encoding: cfg.encoding });
        if (is404(html)) break;
        const pageItems = parseSpecial(html, src, local, minDate);
        if (!pageItems.length) break;
        items.push(...pageItems);
        const oldest = pageItems.map((x) => x.dateISO).sort()[0] || "";
        if (oldest && oldest < minDate) break;
      }
    } else {
      const html = await fetchText(board, { curl: cfg.curl, encoding: cfg.encoding });
      if (!is404(html)) items.push(...parseSpecial(html, src, local, minDate));
    }
  }
  const map = new Map(items.map((it) => [`${it.url}|${it.title}`, it]));
  items = [...map.values()]
    .filter((it) => it.dateISO >= minDate)
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .slice(0, limit);
  return items;
}

async function scrapeOne(src, minDate, useJina) {
  const cfg = SPECIAL[src.id];
  if (cfg) {
    try {
      const items = await scrapeSpecial({ ...src, ...cfg }, cfg, minDate);
      // specialDone: 게시판 조회 성공(0건 포함) — 오염된 이전 글을 다시 병합하지 않음
      return {
        items,
        status: items.length ? "ok" : "empty",
        specialDone: true,
      };
    } catch (e) {
      return { items: [], status: e.name || "error", specialDone: false };
    }
  }
  const urls = candidateUrls(src);
  if (!urls.length) return { items: [], status: "no_url" };
  let err = "empty";
  for (const u of urls) {
    try {
      const html = await fetchText(u);
      const items = parseHtml(html, u, src, minDate);
      if (items.length) return { items, status: "ok" };
    } catch (e) {
      err = e.message || "error";
    }
  }
  if (useJina) {
    for (const u of urls.slice(0, 2)) {
      const md = await fetchJina(u);
      if (!md) continue;
      const items = parseMarkdown(md, src, minDate);
      if (items.length) return { items, status: "ok" };
    }
  }
  return { items: [], status: err };
}

async function mapPool(items, concurrency, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return ret;
}

function loadJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  let raw = fs.readFileSync(filePath, "utf8");
  if (raw.includes("<<<<<<<")) {
    console.warn("warn: conflict markers in", path.basename(filePath));
    return null;
  }
  if (filePath.endsWith(".js")) {
    raw = raw.split("=").slice(1).join("=").trim().replace(/;$/, "");
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function applySpecialSources(sources) {
  return (sources || []).map((s) => {
    const cfg = SPECIAL[s.id];
    if (!cfg) return s;
    return {
      ...s,
      homeUrl: cfg.homeUrl,
      boardUrl: cfg.boardUrl,
      priority: true,
    };
  });
}

function savePayload(payload) {
  const text = JSON.stringify(payload);
  if (text.includes("<<<<<<<") || text.includes(">>>>>>>")) {
    throw new Error("refusing to write conflict markers");
  }
  // validate round-trip
  JSON.parse(text);
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "univ-notices.json"), JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(path.join(ROOT, "univ-board-data.js"), "window.UNIV_BOARD_DATA=" + text + ";\n", "utf8");
  fs.writeFileSync(
    path.join(ROOT, "univ-sources.json"),
    JSON.stringify(payload.sources || [], null, 2),
    "utf8"
  );
}

async function main() {
  const minDate = admissionMinDate();
  const today = seoulToday();
  console.log(`minDate=${minDate} today=${today} concurrency=${CONCURRENCY} jina=${USE_JINA}`);

  let old =
    loadJsonSafe(path.join(ROOT, "univ-board-data.js")) ||
    loadJsonSafe(path.join(ROOT, "data", "univ-notices.json")) ||
    {};
  const sources = applySpecialSources(
    old.sources ||
      JSON.parse(fs.readFileSync(path.join(ROOT, "univ-sources.json"), "utf8"))
  );
  const only = String(process.env.UNIV_ONLY || "")
    .split(/[,:\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const scrapeSources = only.length
    ? sources.filter((s) => only.includes(s.id) || only.includes(s.name))
    : sources;
  if (only.length) {
    console.log(`UNIV_ONLY → ${scrapeSources.map((s) => s.name).join(", ")}`);
  }

  // group by home|board
  const groups = new Map();
  for (const s of scrapeSources) {
    const key = `${s.homeUrl || ""}|${s.boardUrl || ""}`.replace(/^\|$/, s.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const groupList = [...groups.values()];
  console.log(`sources=${sources.length} scrape=${scrapeSources.length} groups=${groupList.length}`);

  const results = new Map();
  const specialDone = new Set();
  let ok = 0;
  let empty = 0;
  let fail = 0;

  // pass 1: direct HTML (all groups)
  const pass1 = await mapPool(groupList, CONCURRENCY, async (group) => {
    const src = {
      ...group[0],
      ...(SPECIAL[group[0].id] || {}),
    };
    try {
      return { group, ...(await scrapeOne(src, minDate, false)) };
    } catch (e) {
      return { group, items: [], status: e.message || "error", specialDone: false };
    }
  });

  for (const r of pass1) {
    if (r.specialDone) {
      for (const s of r.group) specialDone.add(s.id);
    }
    if (r.status === "ok" && r.items.length) {
      ok += 1;
      for (const src of r.group) {
        for (const it of r.items) {
          const copy = {
            ...it,
            univId: src.id,
            univName: src.name,
            homeUrl: src.homeUrl || it.homeUrl || "",
          };
          const k = `${copy.univId}|${copy.url}|${copy.title}`;
          copy.id = sha20(k);
          results.set(k, copy);
        }
      }
      console.log(`OK  ${r.group[0].name}: ${r.items.length}`);
    } else if (r.status === "empty" || r.status === "no_url") {
      empty += 1;
      if (r.specialDone) {
        console.log(`OK  ${r.group[0].name}: 0건 (>=${minDate}) — cleared stale`);
      }
    } else {
      fail += 1;
    }
  }

  // pass 2: jina for empty with boardUrl/priority
  if (USE_JINA) {
    const have = new Set([...results.values()].map((n) => n.univId));
    const need = groupList.filter((g) => {
      if (g.some((s) => have.has(s.id))) return false;
      return Boolean((g[0].boardUrl || "").trim() || g[0].priority || SPECIAL[g[0].id]);
    });
    console.log(`jina_pass candidates=${need.length}`);
    const pass2 = await mapPool(need, Math.min(6, CONCURRENCY), async (group) => {
      const src = { ...group[0], ...(SPECIAL[group[0].id] || {}) };
      try {
        return { group, ...(await scrapeOne(src, minDate, true)) };
      } catch (e) {
        return { group, items: [], status: e.message || "error" };
      }
    });
    for (const r of pass2) {
      if (r.status === "ok" && r.items.length) {
        ok += 1;
        empty = Math.max(0, empty - 1);
        for (const src of r.group) {
          for (const it of r.items) {
            const copy = {
              ...it,
              univId: src.id,
              univName: src.name,
              homeUrl: src.homeUrl || it.homeUrl || "",
            };
            const k = `${copy.univId}|${copy.url}|${copy.title}`;
            copy.id = sha20(k);
            results.set(k, copy);
          }
        }
        console.log(`JINA ${r.group[0].name}: ${r.items.length}`);
      }
    }
  }

  // merge previous valid notices (지정 대학은 이번 수집 성공 시 이전 글 재병합 안 함)
  // UNIV_ONLY 모드에서는 대상 대학만 갱신하고 나머지 대학 글은 유지
  const onlyIds = only.length ? new Set(scrapeSources.map((s) => s.id)) : null;
  for (const n of old.notices || []) {
    if (!n?.dateISO || n.dateISO < minDate || !n.title || !n.url) continue;
    if (onlyIds && !onlyIds.has(n.univId)) {
      const k = `${n.univId}|${n.url}|${n.title}`;
      if (!results.has(k)) results.set(k, n);
      continue;
    }
    if (specialDone.has(n.univId)) continue;
    if (BAD_TITLE.test(n.title) && !(n.title.includes("분실물") && SPECIAL[n.univId])) continue;
    const cfg = SPECIAL[n.univId];
    if (cfg?.allow && !cfg.allow.test(n.url)) continue;
    // 군산대 등: 잘못된 날짜 오염 글(작성일≠목록일) 차단 — 이전 데이터 안전망
    if (n.univId === "u173" && !/boardId=BBS_0000041/i.test(n.url || "")) continue;
    const k = `${n.univId}|${n.url}|${n.title}`;
    if (!results.has(k)) results.set(k, n);
  }

  let notices = [...results.values()].sort((a, b) => {
    const d = String(b.dateISO).localeCompare(String(a.dateISO));
    return d || String(a.title || "").localeCompare(String(b.title || ""), "ko");
  });

  if (!notices.length && (old.notices || []).length) {
    notices = (old.notices || []).filter((n) => n.dateISO && n.dateISO >= minDate);
    console.warn(`warn: using previous notices only (${notices.length})`);
  }
  if (!notices.length) {
    console.error("univ scrape produced no notices");
    process.exit(1);
  }

  const freshCount = [...results.values()].filter((n) => n.dateISO >= minDate).length;
  const payload = {
    minDate,
    today,
    updatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    sources,
    notices,
    priority: old.priority || [],
    stale: false,
    status: "fresh",
    statusReason: `ok=${ok} empty=${empty} fail=${fail} fresh=${freshCount}`,
  };
  savePayload(payload);
  console.log(
    `done ok=${ok} empty=${empty} fail=${fail} notices=${notices.length} univs=${
      new Set(notices.map((n) => n.univId)).size
    }`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
