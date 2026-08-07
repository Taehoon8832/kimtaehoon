# -*- coding: utf-8 -*-
"""전체 대학 입학처 공지 수집 (입시 시즌 8/1~ 자동) → univ-board-data.js"""
from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent


def admission_min_date() -> str:
    """입시 시즌 창: 매년 8/1 ~ 다음 해 7/31 (서울 기준)."""
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    if today.month >= 8:
        return f"{today.year}-08-01"
    return f"{today.year - 1}-08-01"


MIN_DATE = os.environ.get("UNIV_MIN_DATE") or admission_min_date()
MAX_PER = 6
USE_JINA = (os.environ.get("USE_JINA") or "1").strip() not in ("0", "false", "False")
CTX = ssl._create_unverified_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
BAD_TITLE = re.compile(
    r"(채용\s*공고|직원\s*채용|근로장학생|학자금대출|문의\s*\(\d|공지사항\s*더보기|"
    r"^대학\s*입학\s*문의|분실물|OMR|문서등록|예비소집\s*/|졸업\s*\(?예정\)?자\s*안내)",
    re.I,
)

DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
YY_DATE_RE = re.compile(r"(?<!\d)(\d{2})-(\d{2})-(\d{2})(?!\d)")
TITLE_HINT = re.compile(
    r"(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|설명회|시행|모의|상담|접수|결과)"
)
NOTICE_HREF = re.compile(
    r"(notice|bbs|board|article|artcl|공지|소식|news|view|Board|ipsi|admission|ntt|brd)",
    re.I,
)
JUNK = re.compile(
    r"(var\s|function\s|document\.|<\w+|javascript:|bbsrg|사이트맵|로그인|개인정보|이용약관|웹접근성)",
    re.I,
)
SKIP = re.compile(
    r"^(더보기|more|이전|다음|목록|home|로그인|전체|공지사항|공지|뉴스|새글|N|NEW)$",
    re.I,
)
BROKEN = re.compile(r"/admission/html/notice/notice\.asp$|error404|404\.html", re.I)
MD_LINK = re.compile(
    r"\[([^\]]{6,180})\]\((https?://[^)\s]+)\)([\s\S]{0,160}?)"
    r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"
)
COMMON_PATHS = (
    "/notice",
    "/bbs/notice",
    "/board/notice",
    "/admission/notice",
    "/ipsi/notice",
    "/enter/notice",
    "/html/notice/notice.asp",
    "/cms/FR_CON/Board/Board.do",
)

# 정확 수집이 필요한 대학: 지정 공지게시판만 사용
SPECIAL_UNIV = {
    "u188": {  # 목포해양대
        "homeUrl": "https://www.mmu.ac.kr/admission",
        "boardUrl": "https://www.mmu.ac.kr/admission/board/245",
        "allow": re.compile(r"mmu\.ac\.kr/admission/board/245/", re.I),
        "curl": True,
    },
    "u121": {  # 가톨릭꽃동네대
        "homeUrl": "https://www.kkot.ac.kr/ipsi/main/view/",
        "boardUrl": "https://www.kkot.ac.kr/ipsi/board/list?boardManagementNo=1143&menuLevel=2&menuNo=120",
        "allow": re.compile(r"kkot\.ac\.kr/ipsi/board/read\?.*boardManagementNo=1143", re.I),
    },
    "u003": {  # 감리교신대 — 입학공지(mId=516)만
        "homeUrl": "https://www.mtu.ac.kr/mtu/main/main.do?mId=1",
        "boardUrl": "https://www.mtu.ac.kr/mtu/board/list.do?mId=516",
        "allow": re.compile(r"mtu\.ac\.kr/mtu/board/view\.do\?mId=516", re.I),
    },
    "u219": {  # 금오공대
        "homeUrl": "https://iphak.kumoh.ac.kr/ipsi/index.do?sso=ok",
        "boardUrl": "https://iphak.kumoh.ac.kr/ipsi/sub0601.do",
        "allow": re.compile(r"iphak\.kumoh\.ac\.kr/ipsi/sub0601\.do", re.I),
    },
    "u066": {  # 아신대
        "homeUrl": "https://www.acts.ac.kr/admission/design/index.asp",
        "boardUrl": "https://www.acts.ac.kr/modules/board/bd_list.asp?id=univ_admission&ca_no=2&left=occa1",
        "allow": re.compile(r"acts\.ac\.kr/modules/board/bd_view\.asp\?.*id=univ_admission", re.I),
    },
    "u174": {  # 예수대 — 입학처 홈(menu=183), 공지(menu=190)
        "homeUrl": "https://jesus.ac.kr/enter/?menu=183",
        "boardUrl": "https://jesus.ac.kr/enter/?menu=190",
        "allow": re.compile(r"jesus\.ac\.kr/enter/\?menu=190", re.I),
    },
    "u157": {  # 한국전통문화대 — 입학공지(MNU0000210)만 (Q&A 제외)
        "homeUrl": "https://www.knuh.ac.kr/admission/main.do",
        "boardUrl": "https://www.knuh.ac.kr/admission/brd/list.do?mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29",
        "allow": re.compile(r"knuh\.ac\.kr/admission/brd/view\.do\?.*mnuBaseId=MNU0000210", re.I),
    },
    "u044": {  # 한예종 — 입학정보 홈 + 공지사항 전체(bbs 007)
        "homeUrl": "https://www.karts.ac.kr/main/appl.do",
        "boardUrl": "https://www.karts.ac.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000007",
        "allow": re.compile(
            r"karts\.ac\.kr/cop/bbs/selectBoardArticle\.do\?.*bbsId=BBSMSTR_000000000007",
            re.I,
        ),
        "maxPages": 8,
        "maxPer": 20,
        "pageParam": "pageIndex",
    },
    # 동양대 — 입학홍보처 공지사항 전체 (동두천·양주 동일 게시판)
    "u055": {
        "homeUrl": "https://ipsi.dyu.ac.kr/information/information_01/",
        "boardUrl": "https://ipsi.dyu.ac.kr/information/information_01/",
        "allow": re.compile(
            r"ipsi\.dyu\.ac\.kr/information/information_01/\?.*mod=document.*uid=\d+",
            re.I,
        ),
        "maxPages": 6,
        "maxPer": 20,
        "pageParam": "pageid",
    },
    "u227": {
        "homeUrl": "https://ipsi.dyu.ac.kr/information/information_01/",
        "boardUrl": "https://ipsi.dyu.ac.kr/information/information_01/",
        "allow": re.compile(
            r"ipsi\.dyu\.ac\.kr/information/information_01/\?.*mod=document.*uid=\d+",
            re.I,
        ),
        "maxPages": 6,
        "maxPer": 20,
        "pageParam": "pageid",
    },
    # 사관학교 — 입학 공지 게시판 고정 (K2Web / gnu board)
    "u032": {  # 육군사관학교 입시 공지사항
        "homeUrl": "https://www.kma.ac.kr:461/",
        "boardUrl": "https://www.kma.ac.kr:461/kma/2100/subview.do",
        "allow": re.compile(r"kma\.ac\.kr(?::\d+)?/bbs/kma/160/\d+/artclView\.do", re.I),
        "k2Path": r"/bbs/kma/160/",
    },
    "u245": {  # 해군사관학교 입학 공지사항
        "homeUrl": "https://www.navy.ac.kr:4443/sites/iphak/index.do",
        "boardUrl": "https://www.navy.ac.kr:4443/iphak/1630/subview.do",
        "allow": re.compile(r"navy\.ac\.kr(?::\d+)?/bbs/iphak/142/\d+/artclView\.do", re.I),
        "k2Path": r"/bbs/iphak/142/",
    },
    "u232": {  # 육군3사관학교 공지사항
        "homeUrl": "https://www.kaay.mil.kr:458/kaay/1142/subview.do",
        "boardUrl": "https://www.kaay.mil.kr:458/kaay/1159/subview.do",
        "allow": re.compile(r"kaay\.mil\.kr(?::\d+)?/bbs/kaay/152/\d+/artclView\.do", re.I),
        "k2Path": r"/bbs/kaay/152/",
    },
    "u123": {  # 공군사관학교 공지사항(2089) — Q&A(1041) 제외
        "homeUrl": "https://rokaf.airforce.mil.kr/sites/afaadmission/index.do",
        "boardUrl": "https://rokaf.airforce.mil.kr/afaadmission/7161/subview.do",
        "allow": re.compile(
            r"rokaf\.airforce\.mil\.kr/bbs/afaadmission/2089/\d+/artclView\.do", re.I
        ),
        "parser": "afa",
    },
    "u109": {  # 국군간호사관학교 공지사항
        "homeUrl": "https://tapply.tonc.net/kafna/",
        "boardUrl": "https://tapply.tonc.net/kafna/?doc=bbs/board.php&bo_table=notice",
        "allow": re.compile(
            r"tapply\.tonc\.net/kafna/\?doc=bbs/board\.php&.*bo_table=notice.*wr_id=\d+",
            re.I,
        ),
        "parser": "kafna",
    },
    "u173": {  # 국립군산대 입학처 전체 공지 — 목록 작성일만 사용
        "homeUrl": "https://www.kunsan.ac.kr/iphak/index.kunsan",
        "boardUrl": (
            "https://www.kunsan.ac.kr/iphak/board/list.kunsan?"
            "boardId=BBS_0000041&menuCd=DOM_000001218001000000&paging=ok&startPage=1"
        ),
        "allow": re.compile(
            r"kunsan\.ac\.kr/iphak/board/view\.kunsan\?.*boardId=BBS_0000041.*dataSid=\d+",
            re.I,
        ),
        "parser": "kunsan",
    },
}


def load_sources():
    js = ROOT / "univ-board-data.js"
    sources = []
    if js.exists():
        raw = js.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";")
        try:
            sources = json.loads(raw).get("sources") or []
        except Exception:
            sources = []
    if not sources:
        sources = json.loads((ROOT / "univ-sources.json").read_text(encoding="utf-8"))
    # 지정 대학 URL을 올바른 입학처/공지 게시판으로 고정
    out = []
    for s in sources:
        cfg = SPECIAL_UNIV.get(s.get("id") or "")
        if cfg:
            s = dict(s)
            s["homeUrl"] = cfg["homeUrl"]
            s["boardUrl"] = cfg["boardUrl"]
        out.append(s)
    return out


def _decode_body(raw: bytes) -> str:
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            if len(re.findall(r"[가-힣]", text)) >= 6 or enc == "cp949":
                return text
        except Exception:
            continue
    return raw.decode("utf-8", "ignore")


def fetch_curl(url: str, timeout: int = 30):
    """일부 서버(목포해양대 등)의 비정상 헤더를 urllib이 거부할 때 폴백."""
    try:
        raw = subprocess.check_output(
            ["curl", "-k", "-L", "-s", "--max-time", str(timeout), "-A", UA, url],
            stderr=subprocess.DEVNULL,
        )
        return 200, _decode_body(raw), url
    except Exception:
        return 0, "", url


def fetch(url: str, timeout: int = 16, prefer_curl: bool = False):
    if prefer_curl:
        code, text, final = fetch_curl(url, timeout=max(timeout, 25))
        if text:
            return code, text, final
    try:
        req = Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            },
        )
        with urlopen(req, context=CTX, timeout=timeout) as res:
            raw = res.read()
            final = res.geturl()
            code = getattr(res, "status", 200) or 200
        return code, _decode_body(raw), final
    except Exception:
        return fetch_curl(url, timeout=max(timeout, 25))


def fetch_jina(url: str) -> str:
    code, text, _ = fetch("https://r.jina.ai/" + url, timeout=40)
    if code >= 400 or len(text) < 200:
        return ""
    return text


def strip_tags(html: str) -> str:
    s = unescape(html or "")
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def to_iso(y, mo, d):
    try:
        iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""
    if iso < "2020-01-01" or iso > "2035-12-31":
        return ""
    return iso


def extract_date(text: str) -> str:
    """여러 날짜가 있으면 마지막 값을 사용(작성일이 뒤에 오는 목록이 많음)."""
    matches = list(DATE_RE.finditer(text or ""))
    if matches:
        m = matches[-1]
        return to_iso(m.group(1), m.group(2), m.group(3))
    # 국간사 등: 26-08-01
    yy = list(YY_DATE_RE.finditer(text or ""))
    if not yy:
        return ""
    m = yy[-1]
    y = int(m.group(1))
    y += 2000 if y < 70 else 1900
    return to_iso(y, m.group(2), m.group(3))


def extract_post_date(text: str) -> str:
    """제목 속 [2026.8.11, 화] 같은 행사·일정일을 제거한 뒤 작성일 추정."""
    cleaned = re.sub(
        r"\[\s*20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}[^\]]*\]",
        " ",
        text or "",
    )
    return extract_date(cleaned)


def clean_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "")).strip()
    t = re.sub(r"^(새글|N|NEW|공지)\s*", "", t, flags=re.I)
    t = DATE_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" ·-|")
    return t


def is_404(html: str) -> bool:
    head = (html or "")[:2800]
    return ("HTTP 오류 404" in head) or ("404.0 - Not Found" in head) or ("error404" in head.lower())


def repair_url(absu: str) -> str:
    """알려진 깨진 입학처 경로 교정 (숙명여대 등)."""
    u = (absu or "").strip()
    u = re.sub(
        r"https?://admission\.sookmyung\.ac\.kr/counsel/",
        "https://admission.sookmyung.ac.kr/admission/html/counsel/",
        u,
        flags=re.I,
    )
    return u


def is_weak_article_url(absu: str, page_url: str) -> bool:
    """홈/메인/해시 링크는 배너성으로 날짜 오염이 잦아 제외."""
    if not absu or not absu.startswith("http"):
        return True
    # 숙명여대 구경로(/counsel/)는 500
    if re.search(r"admission\.sookmyung\.ac\.kr/counsel/", absu, re.I):
        return True
    # 공군사관학교: Q&A(1041) 제외, 공지 글(2089 artclView)만 허용
    if re.search(r"rokaf\.airforce\.mil\.kr", absu, re.I):
        if re.search(r"/bbs/afaadmission/1041/", absu, re.I):
            return True
        if re.search(r"/bbs/afaadmission/2089/\d+/artclView\.do", absu, re.I):
            return False
        return True
    # 육·해·3사관학교: artclView 게시글만
    if re.search(r"kma\.ac\.kr", absu, re.I):
        return not re.search(r"/bbs/kma/160/\d+/artclView\.do", absu, re.I)
    if re.search(r"navy\.ac\.kr", absu, re.I):
        return not re.search(r"/bbs/iphak/142/\d+/artclView\.do", absu, re.I)
    if re.search(r"kaay\.mil\.kr", absu, re.I):
        return not re.search(r"/bbs/kaay/152/\d+/artclView\.do", absu, re.I)
    if re.search(r"tapply\.tonc\.net/kafna", absu, re.I):
        return not re.search(r"bo_table=notice.*wr_id=\d+", absu, re.I)
    low = absu.lower().split("#")[0]
    if low.endswith("#") or absu.strip() in ("#",):
        return True
    if re.search(r"javascript:|void\(0\)", absu, re.I):
        return True
    if BROKEN.search(absu):
        return True
    # 게시글 id 파라미터가 없고 메인/인덱스면 약함
    has_id = bool(
        re.search(
            r"[?&](id|no|seq|idx|bbsidx|ntt|article|artcl|brdIdx|dataSid|uid|num|p_board_idx)=",
            absu,
            re.I,
        )
    )
    if has_id:
        return False
    if re.search(r"/(main|index|intro)(\.(asp|do|php|html?))?/?$", low):
        return True
    # 페이지 URL 자체와 동일하면 목록 배너
    try:
        if urljoin(page_url, ".") == urljoin(absu, ".") and not has_id:
            # same directory index
            if re.search(r"/(main|index)\.", low) or low.rstrip("/").endswith(
                urlparse(page_url).netloc
            ):
                return True
    except Exception:
        pass
    return False


def make_item(src: dict, title_raw: str, preview: str, absu: str, date_iso: str, page_url: str = ""):
    # 목록 작성일 우선. 제목의 행사일([8.11])로 덮어쓰지 않음
    title_date = extract_post_date(title_raw)
    if not date_iso:
        date_iso = title_date
    # 오늘(서울, UTC+9) 이후 날짜는 일정일로 보고 제외
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")
    if date_iso and date_iso > today:
        return None
    title = clean_title(title_raw)
    if not title or len(title) < 8 or len(title) > 140:
        return None
    if SKIP.match(title) or JUNK.search(title):
        return None
    if BAD_TITLE.search(title):
        # 사관학교 분실물 안내는 입시 공지로 유지
        if not (
            src.get("id") in ("u032", "u245", "u123", "u232", "u109")
            and "분실물" in title
        ):
            return None
    if len(re.findall(r"[가-힣]", title)) < 4:
        return None
    if not date_iso or date_iso < MIN_DATE:
        return None
    # 시즌 초반(minDate+30일) 이후 글은 입시 키워드가 있을 때만 허용 (오탐 감소)
    soft_end = (
        datetime.strptime(MIN_DATE, "%Y-%m-%d").date() + timedelta(days=30)
    ).strftime("%Y-%m-%d")
    if date_iso > soft_end and not TITLE_HINT.search(title):
        return None
    if not absu.startswith("http") or BROKEN.search(absu):
        return None
    if is_weak_article_url(absu, page_url or absu):
        return None
    # 화살표/배너형 메뉴 문구 제거
    if re.search(r"화살표|이전페이지|다음페이지|진행도", title):
        return None
    preview = DATE_RE.sub(" ", preview or "")
    preview = re.sub(r"\s+", " ", preview).strip(" ·-|")
    if JUNK.search(preview) or len(re.findall(r"[가-힣]", preview)) < 2:
        preview = f"{src['name']} 입학 공지사항 미리보기"
    if re.search(r"화살표|이전페이지|다음페이지", preview):
        preview = f"{src['name']} 입학 공지사항 미리보기"
    key = f"{src['id']}|{absu}|{title}"
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:20],
        "univId": src["id"],
        "univName": src["name"],
        "title": title,
        "preview": preview[:120],
        "url": absu,
        "homeUrl": src.get("homeUrl") or "",
        "dateISO": date_iso,
        "dateText": date_iso.replace("-", "."),
    }


def parse_afa_notice_board(html: str, page_url: str, src: dict):
    """공군사관학교 공지사항(7161/2089) 전용 파서 — Q&A 제외."""
    items = []
    block = re.compile(
        r'<a\s+href\s*=\s*["\']([^"\']*?/bbs/afaadmission/2089/\d+/artclView\.do)["\'][^>]*'
        r'class="[^"]*artclLinkView[^"]*"[\s\S]*?<strong>([\s\S]*?)</strong>[\s\S]*?'
        r'class="_artclregDate"[\s\S]*?<dd>\s*([^<]+?)\s*</dd>',
        re.I,
    )
    for m in block.finditer(html or ""):
        href, title_html, date_raw = m.group(1), m.group(2), m.group(3)
        title = strip_tags(title_html)
        date_iso = extract_date(date_raw)
        absu = repair_url(urljoin(page_url, href.split("#")[0]))
        it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", absu, date_iso, page_url)
        if it:
            items.append(it)
    # 등록일 클래스명이 다를 때 폴백
    if not items:
        items = parse_k2_artcl_board(
            html, page_url, src, r"/bbs/afaadmission/2089/",
            re.compile(r"rokaf\.airforce\.mil\.kr/bbs/afaadmission/2089/\d+/artclView\.do", re.I),
        )
    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]


def parse_k2_artcl_board(html: str, page_url: str, src: dict, path_re: str, allow=None):
    """K2Web artclView 목록 공통 파서 (육사·해사·3사 등)."""
    items = []
    pat = re.compile(
        rf'href\s*=\s*["\']([^"\']*?{path_re}\d+/artclView\.do)["\']'
        r'[\s\S]{0,1800}?<strong>([\s\S]{0,240}?)</strong>'
        r'[\s\S]{0,1800}?(20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2})',
        re.I,
    )
    for m in pat.finditer(html or ""):
        href, title_html, date_raw = m.group(1), m.group(2), m.group(3)
        title = strip_tags(title_html)
        date_iso = extract_date(date_raw)
        absu = repair_url(urljoin(page_url, href.split("#")[0]))
        if allow and not allow.search(absu):
            continue
        it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", absu, date_iso, page_url)
        if it:
            items.append(it)
    return items


def parse_kafna_notice_board(html: str, page_url: str, src: dict):
    """국군간호사관학교 gnu 게시판 (YY-MM-DD)."""
    items = []
    pat = re.compile(
        r"href=['\"](\./\?doc=bbs/board\.php&bo_table=notice[^'\"]*?wr_id=(\d+)[^'\"]*)['\"]"
        r"[\s\S]{0,200}?<b>([\s\S]{0,200}?)</b>[\s\S]{0,400}?"
        r"(?<!\d)(\d{2}-\d{2}-\d{2})(?!\d)",
        re.I,
    )
    for m in pat.finditer(html or ""):
        href_raw, wr_id, title_html, date_raw = m.group(1), m.group(2), m.group(3), m.group(4)
        title = strip_tags(title_html)
        date_iso = extract_date(date_raw)
        absu = (
            "https://tapply.tonc.net/kafna/"
            f"?doc=bbs/board.php&bo_table=notice&wr_id={wr_id}"
        )
        it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", absu, date_iso, page_url)
        if it:
            items.append(it)
    return items


def parse_kunsan_notice_board(html: str, page_url: str, src: dict):
    """국립군산대 입학처 공지 — 목록 작성일(YYYY-MM-DD)만 사용."""
    items = []
    pat = re.compile(
        r'href="([^"]*/iphak/board/view\.kunsan\?[^"]*boardId=BBS_0000041[^"]*dataSid=(\d+)[^"]*)"'
        r"[^>]*>([\s\S]*?)</a>[\s\S]{0,800}?(20\d{2}-\d{2}-\d{2})",
        re.I,
    )
    for m in pat.finditer(html or ""):
        sid = m.group(2)
        title = strip_tags(m.group(3))
        date_iso = m.group(4)
        absu = (
            "https://www.kunsan.ac.kr/iphak/board/view.kunsan?"
            f"boardId=BBS_0000041&menuCd=DOM_000001218001000000&paging=ok&startPage=1&dataSid={sid}"
        )
        it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", absu, date_iso, page_url)
        if it:
            items.append(it)
    return items


def parse_html(html: str, page_url: str, src: dict):
    if not html or is_404(html):
        return []
    if "rokaf.airforce.mil.kr" in (page_url or "") and (
        "/7161/" in page_url or "afaadmission" in page_url
    ):
        afa = parse_afa_notice_board(html, page_url, src)
        if afa:
            return afa
    items = []
    for m in re.finditer(
        r'<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>([\s\S]{0,120})',
        html,
        re.I,
    ):
        href = unescape(m.group(1)).strip()
        if not href or href.startswith("#") or href.lower().startswith("javascript:"):
            continue
        title = strip_tags(m.group(2))
        tail = strip_tags(m.group(3))
        if not (NOTICE_HREF.search(href) or TITLE_HINT.search(title)):
            continue
        # 제목 날짜 우선, 없으면 바로 뒤 짧은은 꼬리만
        date_iso = extract_date(title) or extract_date(tail)
        if not date_iso:
            continue
        absu = repair_url(urljoin(page_url, href.split("#")[0]))
        it = make_item(src, title, tail, absu, date_iso, page_url)
        if it:
            items.append(it)
    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]


def parse_markdown(md: str, src: dict):
    items = []
    for m in MD_LINK.finditer(md or ""):
        title = strip_tags(m.group(1))
        url = m.group(2).split("#")[0]
        tail = strip_tags(m.group(3))
        date_iso = to_iso(m.group(4), m.group(5), m.group(6))
        if not (NOTICE_HREF.search(url) or TITLE_HINT.search(title)):
            continue
        # 마크다운에서도 제목 날짜가 있으면 그걸 우선
        title_date = extract_date(title)
        if title_date:
            date_iso = title_date
        it = make_item(src, title, tail, url, date_iso, url)
        if it:
            items.append(it)
    # fallback: title lines with nearby dates (no markdown link) — 약한 URL이라 스킵
    # (홈 URL에 날짜만 붙이면 서강대 5/29→8/4 같은 오염이 재발함)
    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]


def candidate_urls(src: dict):
    urls = []
    for u in ((src.get("boardUrl") or "").strip(), (src.get("homeUrl") or "").strip()):
        if u and u not in urls and not BROKEN.search(u):
            urls.append(u)
    home = (src.get("homeUrl") or "").strip()
    if home and not BROKEN.search(home):
        try:
            p = urlparse(home)
            base = f"{p.scheme}://{p.netloc}"
            for path in COMMON_PATHS:
                u = urljoin(base + "/", path.lstrip("/"))
                if u not in urls and not BROKEN.search(u):
                    urls.append(u)
        except Exception:
            pass
    return urls[:5]


def parse_special(html: str, src: dict):
    """지정 대학 공지 게시판 전용 파서."""
    uid = src.get("id") or ""
    cfg = SPECIAL_UNIV.get(uid)
    if not cfg or not html:
        return []
    items = []
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")

    if uid == "u188":  # 목포해양대 board/245
        for m in re.finditer(
            r'href="([^"]*board/245[^"]*read/\d+[^"]*)"[^>]*>([^<]+)</a>[\s\S]*?'
            r'<td class="date">(\d{4}-\d{2}-\d{2})</td>',
            html,
            re.I,
        ):
            href = urljoin(cfg["boardUrl"], m.group(1).rstrip("?"))
            it = make_item(src, m.group(2), f"{src['name']} 입학 공지사항 미리보기", href, m.group(3), cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u121":  # 꽃동네 입학 공지 1143
        for m in re.finditer(
            r'href="((?:https?://[^"]*)?/?ipsi/board/read\?[^"]*boardManagementNo=1143[^"]*)"[^>]*>([\s\S]*?)</a>([\s\S]{0,240})',
            html,
            re.I,
        ):
            title = strip_tags(m.group(2))
            date_iso = extract_date(title + " " + strip_tags(m.group(3)))
            href = urljoin("https://www.kkot.ac.kr", unescape(m.group(1)))
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, date_iso, cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u003":  # 감리교 입학공지 mId=516
        for m in re.finditer(
            r'view\.do\?mId=516&(?:amp;)?brdIdx=(\d+)[^"\']*["\'][^>]*>([\s\S]*?)</a>[\s\S]{0,400}?(20\d{2}-\d{2}-\d{2})',
            html,
            re.I,
        ):
            title = strip_tags(m.group(2))
            href = f"https://www.mtu.ac.kr/mtu/board/view.do?mId=516&brdIdx={m.group(1)}"
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, m.group(3), cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u219":  # 금오공대 입학정보 공지
        for m in re.finditer(
            r'href="([^"]*mode=view&(?:amp;)?articleNo=\d+[^"]*)"[^>]*>([\s\S]*?)</a>',
            html,
            re.I,
        ):
            block = m.group(2)
            date_iso = extract_date(block)
            title = re.sub(r"^공지\s*", "", strip_tags(block))
            title = re.sub(r"\s*국립금오공과대학교.*$", "", title)
            title = DATE_RE.sub("", title).strip()
            href = urljoin(cfg["boardUrl"], unescape(m.group(1)))
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, date_iso, cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u066":  # 아신대 입학 공지
        for m in re.finditer(
            r'bd_view\.asp\?([^"\']+)["\'][^>]*>([\s\S]*?)</a>[\s\S]{0,220}?(20\d{2}-\d{2}-\d{2})',
            html,
            re.I,
        ):
            q = unescape(m.group(1))
            if "id=univ_admission" not in q:
                continue
            title = re.sub(r"\s*교학지원팀\s*$", "", strip_tags(m.group(2))).strip()
            href = urljoin("https://www.acts.ac.kr/modules/board/", "bd_view.asp?" + q)
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, m.group(3), cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u174":  # 예수대 공지 menu=190
        for m in re.finditer(
            r'href="(\./\?menu=190&(?:amp;)?mode=view&(?:amp;)?no=\d+)"[^>]*>([\s\S]*?)</a>([\s\S]{0,280}?)</tr>',
            html,
            re.I,
        ):
            title = strip_tags(m.group(2))
            date_iso = extract_date(m.group(3))
            href = urljoin("https://jesus.ac.kr/enter/", unescape(m.group(1)).lstrip("./"))
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, date_iso, cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]):
                items.append(it)
    elif uid == "u157":  # 한국전통문화대 입학공지
        for m in re.finditer(
            r"fnBrdView\('(\d+)'\)\"[\s\S]*?>([\s\S]*?)</a>[\s\S]*?<td class=\"date\"[^>]*>(20\d{2}-\d{2}-\d{2})</td>",
            html,
            re.I,
        ):
            title = re.sub(r"\[대\s*학\]|\[대학원\]|\[편입학\]", " ", strip_tags(m.group(2)))
            title = re.sub(r"\s+", " ", title).strip()
            href = (
                "https://www.knuh.ac.kr/admission/brd/view.do?"
                f"mnuBaseId=MNU0000210&topBaseId=MNU0000209&tplSer=29&atcSer={m.group(1)}"
            )
            it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", href, m.group(3), cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]) and it["dateISO"] <= today:
                items.append(it)
    elif uid == "u044":  # 한예종 입학 공지사항 전체
        for m in re.finditer(
            r'href="(/cop/bbs/selectBoardArticle\.do\?[^"]*bbsId=BBSMSTR_000000000007[^"]*)"'
            r'[^>]*title="([^"]+)"[\s\S]{0,1200}?<span class="mont">(20\d{2}\.\d{2}\.\d{2})</span>',
            html,
            re.I,
        ):
            raw_href = unescape(m.group(1)).replace("&amp;", "&")
            ntt = re.search(r"nttNo=(\d+)", raw_href, re.I)
            if not ntt:
                continue
            href = (
                "https://www.karts.ac.kr/cop/bbs/selectBoardArticle.do?"
                f"bbsId=BBSMSTR_000000000007&nttNo={ntt.group(1)}"
            )
            title = re.sub(r"\s+", " ", unescape(m.group(2))).strip()
            date_iso = extract_date(m.group(3))
            block = html[m.start() : m.start() + 900]
            cate = ""
            cm = re.search(r'class="[^"]*ntc_vis[^"]*"[^>]*>([^<]+)<', block, re.I)
            if cm:
                cate = strip_tags(cm.group(1)).strip()
            preview = f"[{cate}] 한예종 입학 공지" if cate else "한예종 입학 공지사항 미리보기"
            it = make_item(src, title, preview, href, date_iso, cfg["boardUrl"])
            if it and cfg["allow"].search(it["url"]) and it["dateISO"] <= today:
                items.append(it)
    elif uid in ("u055", "u227"):  # 동양대 입학홍보처 공지사항 전체
        for m in re.finditer(
            r'href="(/information/information_01/\?[^"]*?mod=document(?:&amp;|&#038;|&)uid=(\d+)[^"]*)"'
            r'[\s\S]*?kboard-default-cut-strings">\s*([^<]+?)\s*<'
            r'[\s\S]*?kboard-list-date">(20\d{2}\.\d{2}\.\d{2})</td>',
            html,
            re.I,
        ):
            uid_num = m.group(2)
            href = (
                "https://ipsi.dyu.ac.kr/information/information_01/"
                f"?mod=document&uid={uid_num}"
            )
            title = re.sub(r"\s+", " ", unescape(m.group(3))).strip()
            date_iso = extract_date(m.group(4))
            it = make_item(
                src,
                title,
                f"{src['name']} 입학 공지사항 미리보기",
                href,
                date_iso,
                cfg["boardUrl"],
            )
            if it and cfg["allow"].search(it["url"]) and it["dateISO"] <= today:
                items.append(it)
    elif uid == "u123" or cfg.get("parser") == "afa":
        items.extend(parse_afa_notice_board(html, cfg["boardUrl"], src))
    elif cfg.get("parser") == "kafna" or uid == "u109":
        items.extend(parse_kafna_notice_board(html, cfg["boardUrl"], src))
    elif cfg.get("parser") == "kunsan" or uid == "u173":
        items.extend(parse_kunsan_notice_board(html, cfg["boardUrl"], src))
    elif cfg.get("k2Path"):
        items.extend(
            parse_k2_artcl_board(html, cfg["boardUrl"], src, cfg["k2Path"], cfg.get("allow"))
        )

    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    limit = int(cfg.get("maxPer") or MAX_PER) if cfg else MAX_PER
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:limit]


def _paged_board_url(board: str, page: int, page_param: str) -> str:
    if page_param == "pageid":
        return f"{board.rstrip('/')}/?pageid={page}"
    if "?" in board:
        return f"{board}&{page_param}={page}"
    return f"{board}?{page_param}={page}"


def scrape_one(src, use_jina=False):
    uid = src.get("id") or ""
    special = SPECIAL_UNIV.get(uid)
    if special:
        board = special["boardUrl"]
        try:
            # 다중 페이지 게시판: MIN_DATE 이전 글이 나오면 중단
            if special.get("maxPages"):
                all_items = []
                max_pages = int(special.get("maxPages") or 5)
                page_param = special.get("pageParam") or "pageIndex"
                for page in range(1, max_pages + 1):
                    page_url = _paged_board_url(board, page, page_param)
                    code, html, final = fetch(page_url, timeout=25, prefer_curl=bool(special.get("curl")))
                    if code >= 400 or is_404(html):
                        if page == 1:
                            return [], f"http_{code}"
                        break
                    page_items = parse_special(html, src)
                    if not page_items:
                        if page == 1:
                            return [], "empty"
                        break
                    all_items.extend(page_items)
                    oldest = min((it["dateISO"] for it in page_items), default="")
                    if oldest and oldest < MIN_DATE:
                        break
                    time.sleep(0.25)
                uniq = {f"{it['url']}|{it['title']}": it for it in all_items}
                items = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)
                items = [it for it in items if it["dateISO"] >= MIN_DATE][: int(special.get("maxPer") or MAX_PER)]
                return items, ("ok" if items else "empty")

            code, html, final = fetch(board, timeout=25, prefer_curl=bool(special.get("curl")))
            if code >= 400 or is_404(html):
                return [], f"http_{code}"
            items = parse_special(html, src)
            if items:
                return items, "ok"
            # 특수 파서 실패 시 일반 파서는 쓰지 않음(오탐 방지)
            return [], "empty"
        except Exception as e:
            return [], type(e).__name__

    urls = candidate_urls(src)
    if not urls:
        return [], "no_url"
    all_items = []
    err = ""
    for u in urls:
        try:
            code, html, final = fetch(u)
            if code >= 400 or is_404(html):
                err = f"http_{code}"
                continue
            items = parse_html(html, final, src)
            all_items.extend(items)
            if items:
                break
        except Exception as e:
            err = type(e).__name__
    if not all_items and use_jina:
        for u in urls[:2]:
            try:
                md = fetch_jina(u)
                items = parse_markdown(md, src)
                all_items.extend(items)
                if items:
                    break
                time.sleep(0.35)
            except Exception as e:
                err = "jina_" + type(e).__name__
    uniq = {f"{it['url']}|{it['title']}": it for it in all_items}
    items = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]
    return items, ("ok" if items else (err or "empty"))


def merge_previous_notices(results: dict, old: dict, skip_univs: set | None = None) -> list:
    skip = skip_univs or set()
    for n in old.get("notices") or []:
        if not n.get("dateISO") or n["dateISO"] < MIN_DATE:
            continue
        if not n.get("title") or not n.get("url"):
            continue
        if BAD_TITLE.search(n.get("title") or ""):
            continue
        uid = n.get("univId") or ""
        # 이번 실행에서 지정 대학 게시판을 성공적으로 읽었으면 이전 글 재병합 안 함
        if uid in skip:
            continue
        special = SPECIAL_UNIV.get(uid)
        # 지정 대학은 허용 URL만 유지 (잘못된 게시판·Q&A·상담 글 제거)
        if special and not special["allow"].search(n.get("url") or ""):
            continue
        k = f"{n.get('univId')}|{n.get('url')}|{n.get('title')}"
        results.setdefault(k, n)
    return sorted(results.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)


def main():
    js_path = ROOT / "univ-board-data.js"
    json_path = ROOT / "data" / "univ-notices.json"
    sources = load_sources()
    groups = {}
    for s in sources:
        key = ((s.get("homeUrl") or "") + "|" + (s.get("boardUrl") or "")).strip("|")
        if not key:
            key = s["id"]
        groups.setdefault(key, []).append(s)

    print(f"sources={len(sources)} groups={len(groups)}")
    results = {}
    special_done: set[str] = set()
    ok = empty = fail = 0
    scrape_error = None

    try:
        # pass 1: fast direct HTML
        with ThreadPoolExecutor(max_workers=12) as ex:
            futs = {ex.submit(scrape_one, g[0], False): g for g in groups.values()}
            for fut in as_completed(futs):
                group = futs[fut]
                name = group[0]["name"]
                try:
                    items, status = fut.result()
                except Exception as e:
                    fail += 1
                    print(f"ERR {name}: {type(e).__name__}")
                    continue
                if SPECIAL_UNIV.get(group[0].get("id") or "") and status in ("ok", "empty"):
                    for s in group:
                        special_done.add(s["id"])
                if status == "ok":
                    ok += 1
                    for src in group:
                        for it in items:
                            copy = dict(it)
                            copy["univId"] = src["id"]
                            copy["univName"] = src["name"]
                            copy["homeUrl"] = src.get("homeUrl") or copy.get("homeUrl") or ""
                            k = f"{copy['univId']}|{copy['url']}|{copy['title']}"
                            copy["id"] = hashlib.sha1(k.encode()).hexdigest()[:20]
                            results[k] = copy
                    print(f"OK  {name}: {len(items)}")
                elif status in ("empty", "no_url"):
                    empty += 1
                    if group[0].get("id") in special_done:
                        print(f"OK  {name}: 0건 (>={MIN_DATE}) — cleared stale")
                else:
                    fail += 1

        # pass 2: jina for empty groups that have boardUrl (rate-limited)
        need_jina = []
        have_univ = {it["univId"] for it in results.values()}
        for g in groups.values():
            if any(s["id"] in have_univ for s in g):
                continue
            if (g[0].get("boardUrl") or "").strip() or (g[0].get("priority")):
                need_jina.append(g)

        if USE_JINA:
            print(f"jina_pass candidates={len(need_jina)}")
            for g in need_jina:
                try:
                    items, status = scrape_one(g[0], True)
                except Exception as e:
                    print(f"JINA ERR {g[0]['name']}: {type(e).__name__}")
                    time.sleep(0.55)
                    continue
                name = g[0]["name"]
                if status == "ok":
                    ok += 1
                    empty = max(0, empty - 1)
                    for src in g:
                        for it in items:
                            copy = dict(it)
                            copy["univId"] = src["id"]
                            copy["univName"] = src["name"]
                            copy["homeUrl"] = src.get("homeUrl") or copy.get("homeUrl") or ""
                            k = f"{copy['univId']}|{copy['url']}|{copy['title']}"
                            copy["id"] = hashlib.sha1(k.encode()).hexdigest()[:20]
                            results[k] = copy
                    print(f"JINA {name}: {len(items)}")
                time.sleep(0.55)
        else:
            print("jina_pass skipped (USE_JINA=0)")
    except Exception as e:
        scrape_error = e
        print(f"error: univ scrape aborted: {e}")

    fresh_count = len(results)
    notices = sorted(results.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)
    priority = []
    old = {}
    if js_path.exists():
        try:
            old = json.loads(js_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
            priority = old.get("priority") or []
            notices = merge_previous_notices(results, old, special_done)
        except Exception:
            priority = []
    elif json_path.exists():
        try:
            old = json.loads(json_path.read_text(encoding="utf-8"))
            priority = old.get("priority") or []
            notices = merge_previous_notices(results, old, special_done)
        except Exception:
            priority = []

    if not notices and old.get("notices"):
        notices = [n for n in old["notices"] if n.get("dateISO") and n["dateISO"] >= MIN_DATE]
        print(f"warn: using previous notices only ({len(notices)})")

    if not notices:
        raise SystemExit(f"univ scrape produced no notices ({scrape_error or 'empty'})")
    today = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")
    payload = {
        "minDate": MIN_DATE,
        "today": today,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "checkedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": sources,
        "notices": notices,
        "priority": priority,
        "stale": fresh_count == 0,
        "status": "cached" if fresh_count == 0 else "fresh",
        "statusReason": f"ok={ok} empty={empty} fail={fail} fresh={fresh_count}",
    }
    (ROOT / "univ-sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    js = "window.UNIV_BOARD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    js_path.write_text(js, encoding="utf-8")
    univs = len({n["univId"] for n in notices})
    print(f"done ok={ok} empty={empty} fail={fail} notices={len(notices)} univs={univs}")
    print(f"wrote {js_path.name} and {json_path.as_posix()}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # 이전 데이터가 있으면 워크플로를 깨지 않음
        js_path = ROOT / "univ-board-data.js"
        json_path = ROOT / "data" / "univ-notices.json"
        for path in (json_path, js_path):
            if path.exists() and path.stat().st_size > 100:
                print(f"fatal retained previous board data after error: {e}")
                raise SystemExit(0)
        raise
