# -*- coding: utf-8 -*-
"""입학처 homeUrl 기준 전체 공지 제목·내용 미리보기 수집 → univ-board-data.js"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
MIN_DATE = "2026-01-01"  # 미리보기용 (표시는 최신 우선)
MAX_PER_UNIV = 2
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
CTX = ssl._create_unverified_context()

DATE_RE = re.compile(
    r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"
)
SKIP_TITLE = re.compile(
    r"^(더보기|more|이전|다음|목록|home|로그인|전체|공지사항|공지|뉴스|닫기|메뉴)$",
    re.I,
)
JUNK = re.compile(
    r"(var\s|function\s|document\.|<\w+|[{};]=|bbsrg|nowd|rsD|onclick|javascript:)",
    re.I,
)
NOTICE_HINT = re.compile(
    r"(notice|bbs|board|article|artcl|공지|소식|news|ipsi|admission|view|게시)",
    re.I,
)
TITLE_HINT = re.compile(
    r"(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|실기|논술|설명회)"
)


def load_sources():
    return json.loads((ROOT / "univ-sources.json").read_text(encoding="utf-8"))


def fetch(url: str, timeout: int = 16) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
    )
    with urlopen(req, context=CTX, timeout=timeout) as res:
        raw = res.read()
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            if len(re.findall(r"[가-힣]", text)) >= 5 or enc == "cp949":
                return text
        except Exception:
            continue
    return raw.decode("utf-8", errors="ignore")


def strip_tags(html: str) -> str:
    s = unescape(html or "")
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def to_iso(y, mo, d) -> str:
    try:
        iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""
    if iso < "2020-01-01" or iso > "2035-12-31":
        return ""
    return iso


def abs_url(href: str, base: str) -> str:
    href = unescape((href or "").strip()).split("#")[0]
    if not href or href.startswith("javascript:") or href == "#":
        return ""
    if href.startswith("//"):
        return "https:" + href
    try:
        return urljoin(base, href)
    except Exception:
        return ""


def extract_date(text: str) -> str:
    m = DATE_RE.search(text or "")
    if not m:
        return ""
    return to_iso(m.group(1), m.group(2), m.group(3))


def is_404_page(html: str) -> bool:
    head = (html or "")[:2500]
    return ("HTTP 오류 404" in head) or ("404.0 - Not Found" in head) or (
        re.search(r"<title>[^<]*404[^<]*</title>", head, re.I) is not None
        and "공지" not in head
    )


def parse_notices(html: str, src: dict, page_url: str):
    if not html or is_404_page(html):
        return []
    items = []
    # anchor + nearby tail for date/preview
    for m in re.finditer(
        r'<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>([\s\S]{0,280})',
        html,
        re.I,
    ):
        href = m.group(1)
        title = strip_tags(m.group(2))
        tail = strip_tags(m.group(3))
        if not title or len(title) < 8 or len(title) > 120:
            continue
        if SKIP_TITLE.match(title) or JUNK.search(title):
            continue
        if len(re.findall(r"[가-힣]", title)) < 4:
            continue
        if not (NOTICE_HINT.search(href) or TITLE_HINT.search(title)):
            continue
        date_iso = extract_date(tail) or extract_date(title)
        if not date_iso or date_iso < MIN_DATE:
            continue
        url = abs_url(href, page_url)
        if not url or url.rstrip("/") == page_url.rstrip("/"):
            continue
        # preview = nearby text without the date echo
        preview = DATE_RE.sub(" ", tail)
        preview = re.sub(r"\s+", " ", preview).strip(" ·-|")
        if JUNK.search(preview) or len(re.findall(r"[가-힣]", preview)) < 4:
            preview = f"{src['name']} 입학처 전체 공지사항"
        preview = preview[:96]
        key = f"{src['id']}|{url}|{title}"
        items.append(
            {
                "id": hashlib.sha1(key.encode("utf-8")).hexdigest()[:20],
                "univId": src["id"],
                "univName": src["name"],
                "title": title,
                "preview": preview,
                "url": url,
                "homeUrl": src.get("homeUrl") or "",
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )

    # table rows fallback
    for m in re.finditer(r"<tr[^>]*>([\s\S]*?)</tr>", html, re.I):
        row = m.group(1)
        if re.search(r"<th[\s>]", row, re.I):
            continue
        a = re.search(
            r'<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>', row, re.I
        )
        if not a:
            continue
        title = strip_tags(a.group(2))
        date_iso = extract_date(strip_tags(row))
        if not title or len(title) < 8 or not date_iso or date_iso < MIN_DATE:
            continue
        if SKIP_TITLE.match(title) or JUNK.search(title):
            continue
        if len(re.findall(r"[가-힣]", title)) < 4:
            continue
        if not (NOTICE_HINT.search(a.group(1)) or TITLE_HINT.search(title)):
            continue
        url = abs_url(a.group(1), page_url)
        if not url:
            continue
        key = f"{src['id']}|{url}|{title}"
        items.append(
            {
                "id": hashlib.sha1(key.encode("utf-8")).hexdigest()[:20],
                "univId": src["id"],
                "univName": src["name"],
                "title": title,
                "preview": f"{src['name']} 입학처 전체 공지사항",
                "url": url,
                "homeUrl": src.get("homeUrl") or "",
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )

    uniq = {}
    for it in items:
        uniq[f"{it['url']}|{it['title']}"] = it
    out = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)
    return out[:MAX_PER_UNIV]


def scrape_source(src: dict):
    home = (src.get("homeUrl") or "").strip()
    board = (src.get("boardUrl") or "").strip()
    # 입학처 URL 기준: home 우선, board는 보조
    urls = []
    for u in (home, board):
        if u and u not in urls:
            urls.append(u)
    if not urls:
        return [], "no_url"

    all_items = []
    last_err = ""
    for u in urls:
        try:
            html = fetch(u)
            items = parse_notices(html, src, u)
            all_items.extend(items)
            if items:
                break
        except Exception as e:
            last_err = f"{type(e).__name__}"
            continue

    uniq = {}
    for it in all_items:
        uniq[f"{it['url']}|{it['title']}"] = it
    items = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[
        :MAX_PER_UNIV
    ]
    if items:
        return items, "ok"
    return [], last_err or "empty"


def main():
    sources = load_sources()
    # unique by homeUrl to avoid double work, then expand names
    by_home = {}
    for s in sources:
        key = (s.get("homeUrl") or s.get("boardUrl") or s["id"]).strip()
        by_home.setdefault(key, []).append(s)

    print(f"sources={len(sources)} homes={len(by_home)}")
    results = {}
    ok = empty = fail = 0

    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(scrape_source, group[0]): group for group in by_home.values()}
        for fut in as_completed(futs):
            group = futs[fut]
            items, status = fut.result()
            name = group[0]["name"]
            if status == "ok":
                ok += 1
                # replicate for campus aliases sharing same home
                for src in group:
                    for it in items:
                        copy = dict(it)
                        copy["univId"] = src["id"]
                        copy["univName"] = src["name"]
                        copy["homeUrl"] = src.get("homeUrl") or copy.get("homeUrl") or ""
                        key = f"{copy['univId']}|{copy['url']}|{copy['title']}"
                        copy["id"] = hashlib.sha1(key.encode()).hexdigest()[:20]
                        results[key] = copy
                print(f"OK  {name}: {len(items)}")
            elif status == "empty":
                empty += 1
            else:
                fail += 1
                print(f"--  {name}: {status}")

    notices = sorted(
        results.values(),
        key=lambda x: (x["dateISO"], x.get("title") or ""),
        reverse=True,
    )
    # hard cap for file size / UI
    if len(notices) > 500:
        notices = notices[:500]

    payload = {
        "minDate": MIN_DATE,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": sources,
        "notices": notices,
    }
    (ROOT / "univ-sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    js = (
        "window.UNIV_BOARD_DATA="
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    (ROOT / "univ-board-data.js").write_text(js, encoding="utf-8")
    print(f"done ok={ok} empty={empty} fail={fail} notices={len(notices)}")


if __name__ == "__main__":
    main()
