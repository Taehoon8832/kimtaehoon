# -*- coding: utf-8 -*-
"""교육 정책·정보 다출처 병합 → edu-board-data.js / data/edu-notices.json"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.parse import quote, urljoin

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _board_io import (  # noqa: E402
    fetch_text,
    keep_previous_if_weak,
    load_previous,
    utc_now_iso,
    write_board,
)

DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
MAX_PER_SOURCE = 8
MAX_TOTAL = 104  # 출처당 상한 × 출처 수 — 오래된 출처가 잘리지 않게

SOURCES = [
    {
        "id": "kice_notice",
        "name": "평가원공지",
        "url": "https://www.suneung.re.kr/boardCnts/list.do?boardID=1500229&m=0301&s=suneung&searchStr=",
        "kind": "kice",
        "board": "1500229",
        "menu": "0301",
    },
    {
        "id": "kice_press",
        "name": "평가원보도",
        "url": "https://www.suneung.re.kr/boardCnts/list.do?boardID=1500230&m=0302&s=suneung&searchStr=",
        "kind": "kice",
        "board": "1500230",
        "menu": "0302",
    },
    {
        "id": "veritas",
        "name": "베리타스알파",
        "url": "https://www.veritas-a.com/news/articleList.html?sc_section_code=S1N2&view_type=sm",
        "kind": "newsmp",
        "base": "https://www.veritas-a.com",
    },
    {
        "id": "ebsi",
        "name": "EBSi",
        "url": "https://www.ebsi.co.kr/ebs/pot/poth/retrieveNotcRmTotList.ebs",
        "kind": "ebsi",
    },
    {
        "id": "moe_blog",
        "name": "교육부블로그",
        "url": "https://blog.naver.com/PostList.naver?blogId=moeblog",
        "kind": "moe_blog",
        "api": "https://m.blog.naver.com/api/blogs/moeblog/post-list?categoryNo=0&itemCount=20&page=1",
    },
    {
        "id": "edupress",
        "name": "에듀프레스",
        "url": "https://www.edupress.kr/news/articleList.html?sc_section_code=S1N5&view_type=sm",
        "kind": "edupress",
        "base": "https://www.edupress.kr",
    },
    {
        "id": "edujin",
        "name": "에듀진",
        "url": "https://www.edujin.co.kr/news/articleList.html?sc_sub_section_code=S2N91&view_type=sm",
        "kind": "newsmp",
        "base": "https://www.edujin.co.kr",
    },
    {
        "id": "nextplay",
        "name": "괜찮은뉴스",
        "url": "https://www.nextplay.kr/news/articleList.html?sc_section_code=S1N1&view_type=sm",
        "kind": "newsmp",
        "base": "https://www.nextplay.kr",
    },
    {
        "id": "unn",
        "name": "한국대학신문",
        "url": "https://news.unn.net/news/articleList.html?sc_section_code=S1N92&view_type=sm",
        "kind": "newsmp",
        "base": "https://news.unn.net",
    },
    {
        "id": "adiga",
        "name": "어디가",
        "url": "https://www.adiga.kr/cct/pbf/noticeView.do?menuId=PCCCTPBF1000",
        "kind": "adiga",
    },
    {
        "id": "jongro",
        "name": "종로학원",
        "url": "https://www.jongro.co.kr/reports/examAnalysisList.asp",
        "kind": "jongro",
    },
    {
        "id": "sen",
        "name": "서울시교육청",
        "url": "https://www.sen.go.kr/user/bbs/BD_selectBbsList.do?q_bbsSn=1036",
        "kind": "sen",
    },
    {
        "id": "moe",
        "name": "교육부",
        "url": "https://www.moe.go.kr/boardCnts/listRenew.do?boardID=337&m=0303&s=moe",
        "kind": "moe",
    },
]


def seoul_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=9)


def seoul_today() -> str:
    return seoul_now().strftime("%Y-%m-%d")


def to_iso(y, mo, d) -> str:
    try:
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""


def extract_date(text: str) -> str:
    m = DATE_RE.search(text or "")
    return to_iso(m.group(1), m.group(2), m.group(3)) if m else ""


def strip_tags(html: str) -> str:
    s = html or ""
    for _ in range(3):
        s2 = unescape(s)
        if s2 == s:
            break
        s = s2
    s = s.replace("&apos;", "'").replace("&quot;", '"')
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    # 실제 HTML 태그만 제거 (<2027 …> 같은 본문 꺾쇠는 유지)
    s = re.sub(r"</?[a-zA-Z!][^>]*>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def ts_ms_to_iso(ms, today: str) -> str:
    try:
        dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc) + timedelta(hours=9)
        iso = dt.strftime("%Y-%m-%d")
        return iso if iso <= today else today
    except Exception:
        return ""


def md_yy_date(raw: str, today: str) -> str:
    """'03-31 11:04' / '08-06' → ISO (올해·작년 보정)."""
    m = re.search(r"(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{2})?", raw or "")
    if not m:
        return ""
    year = int(today[:4])
    mo, dd = int(m.group(1)), int(m.group(2))
    iso = to_iso(year, mo, dd)
    if iso and iso > today:
        iso = to_iso(year - 1, mo, dd)
    return iso if iso and iso <= today else ""


def fetch_html(src: dict) -> str:
    url = src["url"]
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Referer": url,
    }
    try:
        html = fetch_text(url, headers=headers, timeout=22, retries=2)
        if len(html) > 800:
            return html
        print(f"warn: {src['name']} thin direct html len={len(html)}")
    except Exception as e:
        print(f"warn: {src['name']} direct: {e}")
    if src.get("jina", True):
        try:
            mirror = fetch_text(
                "https://r.jina.ai/" + url,
                headers={"Accept": "text/plain,*/*"},
                timeout=40,
                retries=1,
            )
            if len(mirror) > 300:
                return mirror
        except Exception as e:
            print(f"warn: {src['name']} jina: {e}")
    return ""


def make_item(src: dict, title: str, href: str, date_iso: str, preview: str, today: str):
    title = re.sub(r"\s+", " ", strip_tags(title)).strip()
    title = re.sub(r"^(새글|N|NEW|공지|필독)\s*", "", title, flags=re.I)
    if not title or len(title) < 8 or len(title) > 160:
        return None
    if re.match(r"^(http|www\.|로그인|회원가입|더보기|이전|다음|목록|구독)", title, re.I):
        return None
    if re.match(r"^[은는이가을를에의와과도만]\s", title):
        return None
    if len(re.findall(r"[가-힣a-zA-Z0-9]", title)) < 6:
        return None
    if not date_iso or date_iso > today or date_iso < "2020-01-01":
        return None
    if not href.startswith("http"):
        return None
    preview = strip_tags(preview)[:120] or f"{src['name']} 소식"
    key = f"{src['id']}|{href}|{title}"
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:20],
        "sourceId": src["id"],
        "sourceName": src["name"],
        "title": title[:160],
        "preview": preview,
        "url": href.split("#")[0],
        "dateISO": date_iso,
        "dateText": date_iso.replace("-", "."),
    }


def parse_newsmp(html: str, src: dict, today: str) -> list:
    base = src.get("base") or ""
    out = []
    for m in re.finditer(
        r'class="titles"[\s\S]{0,80}?href="((?:https?://[^"]*)?/news/articleView\.html\?[^"]+)"[^>]*>([\s\S]{0,300}?)</a>'
        r'[\s\S]{0,1000}?class="byline"[\s\S]{0,400}?(20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})',
        html,
        re.I,
    ):
        href = urljoin(base + "/", unescape(m.group(1)).replace("&amp;", "&"))
        title = strip_tags(m.group(2))
        date_iso = extract_date(m.group(3))
        lead_m = re.search(r'class="lead"[^>]*>[\s\S]{0,60}?>([\s\S]{0,240}?)</', m.group(0), re.I)
        lead = lead_m.group(1) if lead_m else f"{src['name']} 소식"
        it = make_item(src, title, href, date_iso, lead, today)
        if it:
            out.append(it)
    return out


def parse_edupress(html: str, src: dict, today: str) -> list:
    base = src.get("base") or "https://www.edupress.kr"
    out = []
    for m in re.finditer(
        r'href="((?:https?://[^"]*)?/news/articleView\.html\?idxno=\d+)"[^>]*>\s*([\s\S]{0,220}?)\s*</a>'
        r'[\s\S]{0,900}?(\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})',
        html,
        re.I,
    ):
        href = urljoin(base + "/", unescape(m.group(1)).replace("&amp;", "&"))
        title = strip_tags(m.group(2))
        if len(title) < 10:
            continue
        date_iso = md_yy_date(m.group(3), today)
        preview = f"{src['name']} 소식"
        lead = re.search(r'class="altlist-summary"[^>]*>\s*([\s\S]{0,200}?)\s*</', m.group(0), re.I)
        if lead:
            preview = lead.group(1)
        it = make_item(src, title, href, date_iso, preview, today)
        if it:
            out.append(it)
    return out


def parse_kice(html: str, src: dict, today: str) -> list:
    out = []
    board = src.get("board") or "1500229"
    menu = src.get("menu") or "0301"
    for m in re.finditer(
        r"goView\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,[^)]*\)[\s\S]{0,240}?>([\s\S]{0,200}?)</a>[\s\S]{0,260}?(20\d{2}-\d{2}-\d{2})",
        html,
        re.I,
    ):
        bid, seq = m.group(1), m.group(2)
        href = (
            "https://www.suneung.re.kr/boardCnts/view.do?"
            f"boardID={bid}&boardSeq={seq}&lev=0&m={menu}&s=suneung"
        )
        it = make_item(src, m.group(3), href, m.group(4), f"{src['name']} 공지", today)
        if it:
            out.append(it)
    return out


def parse_moe(html: str, src: dict, today: str) -> list:
    out = []
    for m in re.finditer(
        r"goView\(\s*'(\d+)'\s*,\s*'(\d+)'\s*,[^)]*\)[\s\S]{0,240}?>([\s\S]{0,200}?)</a>[\s\S]{0,260}?(20\d{2}-\d{2}-\d{2})",
        html,
        re.I,
    ):
        href = (
            "https://www.moe.go.kr/boardCnts/viewRenew.do?"
            f"boardID={m.group(1)}&boardSeq={m.group(2)}&lev=0&m=0303&s=moe"
        )
        it = make_item(src, m.group(3), href, m.group(4), "교육부 정책", today)
        if it:
            out.append(it)
    return out


def parse_ebsi(html: str, src: dict, today: str) -> list:
    out = []
    for m in re.finditer(
        r"goView\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'[^']*'\)[\s\S]{0,300}?"
        r'class="cout_tf"[^>]*>([\s\S]{0,220}?)</span>[\s\S]{0,400}?(\d{2}\.\d{2}\.\d{2})',
        html,
        re.I,
    ):
        bbs, art = m.group(1), m.group(2)
        href = (
            "https://www.ebsi.co.kr/ebs/pot/poth/retrieveNotcRmTotArtcl.ebs?"
            f"bbsId={quote(bbs)}&artclId={quote(art)}"
        )
        yy, mo, dd = m.group(4).split(".")
        date_iso = to_iso(2000 + int(yy), mo, dd)
        it = make_item(src, m.group(3), href, date_iso, "EBSi 알림", today)
        if it:
            out.append(it)
    return out


def parse_adiga(html: str, src: dict, today: str) -> list:
    out = []
    for m in re.finditer(
        r'fnDetailPage\(\s*&quot;(\d+)&quot;\s*\)">([\s\S]{0,200}?)</a>[\s\S]{0,200}?(20\d{2}-\d{2}-\d{2})',
        html,
        re.I,
    ):
        href = f"https://www.adiga.kr/cct/pbf/noticeDetail.do?menuId=PCCCTPBF1000&prtlBbsId={m.group(1)}"
        it = make_item(src, m.group(2), href, m.group(3), "어디가 공지", today)
        if it:
            out.append(it)
    for m in re.finditer(
        r'fnDetailPage\(\s*"(\d+)"\s*\)">([\s\S]{0,200}?)</a>[\s\S]{0,200}?(20\d{2}-\d{2}-\d{2})',
        html,
        re.I,
    ):
        href = f"https://www.adiga.kr/cct/pbf/noticeDetail.do?menuId=PCCCTPBF1000&prtlBbsId={m.group(1)}"
        it = make_item(src, m.group(2), href, m.group(3), "어디가 공지", today)
        if it:
            out.append(it)
    return out


def parse_jongro(html: str, src: dict, today: str) -> list:
    out = []
    for m in re.finditer(
        r'JavaScript:Read\((\d+)\);">([\s\S]{0,200}?)</a>[\s\S]{0,260}?class="info_date"[^>]*>(20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})',
        html,
        re.I,
    ):
        href = (
            "https://www.jongro.co.kr/reports/examAnalysisView.asp?"
            f"idx={m.group(1)}&page=1&s_academicyear=&s_option1=&s_option2="
            "&s_option3=&s_option4=&s_key=&s_value=&s_intPageSize=12"
        )
        date_iso = extract_date(m.group(3))
        it = make_item(src, m.group(2), href, date_iso, "종로학원 입시분석", today)
        if it:
            out.append(it)
    if not out:
        for m in re.finditer(
            r'Read\((\d+)\)[^>]*>\s*([^<]{10,160}?)\s*</a>[\s\S]{0,300}?(20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2})',
            html,
            re.I,
        ):
            href = (
                "https://www.jongro.co.kr/reports/examAnalysisView.asp?"
                f"idx={m.group(1)}&page=1&s_academicyear=&s_option1=&s_option2="
                "&s_option3=&s_option4=&s_key=&s_value=&s_intPageSize=12"
            )
            it = make_item(src, m.group(2), href, extract_date(m.group(3)), "종로학원 입시분석", today)
            if it:
                out.append(it)
    return out


def parse_sen(html: str, src: dict, today: str) -> list:
    out = []
    for m in re.finditer(
        r"data-name='연도'[^>]*>\s*(\d{4})\s*<[\s\S]{0,260}?data-name='월'[^>]*>\s*(\d{1,2})\s*<"
        r"[\s\S]{0,500}?class=\"bbs_title[^\"]*\"[^>]*>\s*([\s\S]{0,160}?)\s*</td>",
        html,
        re.I,
    ):
        year, month = m.group(1), m.group(2)
        title = strip_tags(m.group(3))
        # 자료실 월 기준 말일 근사
        date_iso = to_iso(year, month, 28)
        if date_iso > today:
            date_iso = to_iso(year, month, 1)
            if date_iso > today:
                continue
        it = make_item(src, title, src["url"], date_iso, "서울시교육청 학력평가", today)
        if it:
            out.append(it)
    return out


def scrape_moe_blog(src: dict, today: str) -> list:
    api = src.get("api") or ""
    raw = fetch_text(
        api,
        headers={
            "Accept": "application/json,*/*",
            "Referer": "https://m.blog.naver.com/moeblog",
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            ),
        },
        timeout=20,
        retries=3,
    )
    data = json.loads(raw)
    items = (((data or {}).get("result") or {}).get("items")) or []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = strip_tags(str(it.get("titleWithInspectMessage") or it.get("title") or ""))
        log_no = it.get("logNo")
        if not title or not log_no:
            continue
        href = f"https://blog.naver.com/moeblog/{log_no}"
        date_iso = ts_ms_to_iso(it.get("addDate"), today) or today
        preview = strip_tags(str(it.get("briefContents") or ""))[:120] or "교육부 블로그"
        row = make_item(src, title, href, date_iso, preview, today)
        if row:
            out.append(row)
    return out


PARSERS = {
    "newsmp": parse_newsmp,
    "edupress": parse_edupress,
    "kice": parse_kice,
    "ebsi": parse_ebsi,
    "moe": parse_moe,
    "sen": parse_sen,
    "adiga": parse_adiga,
    "jongro": parse_jongro,
}


def scrape_one(src: dict, today: str) -> list:
    try:
        if src["kind"] == "moe_blog":
            items = scrape_moe_blog(src, today)
        else:
            html = fetch_html(src)
            if not html:
                print(f"{src['name']}: empty")
                return []
            parser = PARSERS.get(src["kind"])
            if not parser:
                print(f"{src['name']}: no parser")
                return []
            items = parser(html, src, today)
        uniq = {}
        for it in items:
            uniq[f"{it['url']}|{it['title']}"] = it
        items = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER_SOURCE]
        print(f"{src['name']}: {len(items)}")
        return items
    except Exception as e:
        print(f"{src['name']}: ERR {type(e).__name__}: {e}")
        return []


def main():
    js_path = ROOT / "edu-board-data.js"
    json_path = ROOT / "data" / "edu-notices.json"
    previous = load_previous(json_path, js_path)
    today = seoul_today()
    collected = []
    try:
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(scrape_one, src, today): src for src in SOURCES}
            for fut in as_completed(futs):
                try:
                    collected.extend(fut.result())
                except Exception as e:
                    print(f"err {futs[fut]['name']}: {e}")
        uniq = {}
        for it in collected:
            uniq[f"{it['sourceId']}|{it['url']}|{it['title']}"] = it
        notices = sorted(uniq.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)[:MAX_TOTAL]
        notices, reason = keep_previous_if_weak(
            new_notices=notices,
            previous=previous,
            min_absolute=8,
            min_keep_ratio=0.2,
        )
        kept_prev = reason.startswith("keep_prev")
    except Exception as e:
        print(f"error: edu scrape failed: {e}")
        if previous and previous.get("notices"):
            notices = previous["notices"]
            kept_prev = True
            reason = f"keep_prev_exception:{type(e).__name__}"
        else:
            raise SystemExit(0)

    if kept_prev and previous and previous.get("notices") == notices and previous.get("today") == today:
        print(f"unchanged {len(notices)} ({reason})")
        return

    payload = {
        "source": "multi",
        "sources": [{"id": s["id"], "name": s["name"], "url": s["url"]} for s in SOURCES],
        "updatedAt": previous.get("updatedAt") if kept_prev and previous else utc_now_iso(),
        "checkedAt": utc_now_iso(),
        "today": today,
        "count": len(notices),
        "notices": notices,
        "stale": bool(kept_prev),
        "status": "cached" if kept_prev else "fresh",
        "statusReason": reason,
    }
    if not kept_prev:
        payload["updatedAt"] = utc_now_iso()
    write_board(js_path=js_path, json_path=json_path, global_name="EDU_BOARD_DATA", payload=payload)
    print(f"wrote {len(notices)} edu items ({payload['statusReason']})")
    by = {}
    for n in notices:
        by[n["sourceName"]] = by.get(n["sourceName"], 0) + 1
    print("by source:", by)
    for n in notices[:12]:
        print(n["dateISO"], n["sourceName"], n["title"][:42], n["url"][:70])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        for path in (ROOT / "data" / "edu-notices.json", ROOT / "edu-board-data.js"):
            if path.exists() and path.stat().st_size > 80:
                print(f"fatal retained previous: {e}")
                raise SystemExit(0)
        raise
