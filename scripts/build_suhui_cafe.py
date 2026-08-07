# -*- coding: utf-8 -*-
"""네이버 카페 수만휘 → suhui-board-data.js / data/suhui-notices.json

공식 boardlist API 우선, HTML/Jina 폴백.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _board_io import (  # noqa: E402
    fetch_text,
    keep_previous_if_weak,
    load_previous,
    utc_now_iso,
    write_board,
)

CAFE_ID = "10197921"
SOURCE = f"https://cafe.naver.com/f-e/cafes/{CAFE_ID}/menus/0?viewType=L"
API = (
    f"https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/{CAFE_ID}/menus/0/articles"
    "?page=1&pageSize=40&sortBy=TIME&viewType=L"
)
DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
MAX_ITEMS = 40


def seoul_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")


def to_iso(y, mo, d) -> str:
    try:
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""


def extract_date(text: str) -> str:
    m = DATE_RE.search(text or "")
    return to_iso(m.group(1), m.group(2), m.group(3)) if m else ""


def strip_tags(html: str) -> str:
    s = unescape(html or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def ts_to_iso(ms, today: str) -> str:
    try:
        # writeDateTimestamp is epoch ms in Seoul-local wall? treat as UTC ms → Seoul date
        dt = datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc) + timedelta(hours=9)
        iso = dt.strftime("%Y-%m-%d")
        return iso if iso <= today else today
    except Exception:
        return ""


def article_url(article_id) -> str:
    return f"https://cafe.naver.com/f-e/cafes/{CAFE_ID}/articles/{article_id}"


def fetch_api(today: str) -> list:
    raw = fetch_text(
        API,
        headers={
            "Accept": "application/json,*/*",
            "Referer": "https://cafe.naver.com/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        },
        timeout=20,
        retries=3,
    )
    data = json.loads(raw)
    rows = (((data or {}).get("result") or {}).get("articleList")) or []
    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        it = row.get("item") if row.get("type") == "ARTICLE" else row.get("item") or row
        if not isinstance(it, dict):
            continue
        title = strip_tags(str(it.get("subject") or it.get("title") or ""))
        title = re.sub(r"^(새글|N|NEW|공지|필독)\s*", "", title, flags=re.I).strip()
        if not title or len(title) < 4:
            continue
        aid = it.get("articleId") or it.get("id")
        if not aid:
            continue
        href = article_url(aid)
        date_iso = ts_to_iso(it.get("writeDateTimestamp"), today) or today
        if date_iso > today:
            continue
        preview = strip_tags(str(it.get("summary") or it.get("content") or ""))[:120] or "수만휘 카페 글"
        # 출처열은 카페명 고정 (메뉴명은 미리보기에 보조 표기)
        menu = strip_tags(str(it.get("menuName") or "")).strip()
        if menu and menu not in preview:
            preview = f"[{menu}] {preview}"[:120]
        key = f"{href}|{title}"
        items.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "sourceName": "수만휘",
                "title": title[:140],
                "preview": preview,
                "url": href,
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )
    print(f"ok naver api {len(items)}")
    return items[:MAX_ITEMS]


def normalize_url(href: str) -> str:
    href = unescape(href or "").replace("&amp;", "&").strip()
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    if href.startswith("/"):
        href = urljoin("https://cafe.naver.com/", href)
    m = re.search(r"articles?/(\d+)", href, re.I)
    if m:
        return article_url(m.group(1))
    m = re.search(r"articleid=(\d+)", href, re.I)
    if m:
        return article_url(m.group(1))
    if "cafe.naver.com" in href:
        return href.split("#")[0]
    return ""


def fetch_page_fallback() -> str:
    try:
        mirror = fetch_text(
            "https://r.jina.ai/" + SOURCE,
            headers={"Accept": "text/plain,*/*"},
            timeout=50,
            retries=2,
        )
        if len(mirror) > 400:
            return mirror
    except Exception as e:
        print(f"warn: jina failed: {e}")
    return ""


def parse_fallback(text: str, today: str) -> list:
    items = []
    for m in re.finditer(
        r"\[([^\]]{6,140})\]\((https?://(?:cafe\.naver\.com|m\.cafe\.naver\.com)[^)]+)\)([\s\S]{0,240}?)",
        text,
    ):
        title = strip_tags(m.group(1))
        href = normalize_url(m.group(2))
        date_iso = extract_date(m.group(0)) or extract_date(m.group(3))
        if not href or not title:
            continue
        if not date_iso:
            if re.search(r"오늘|방금|분\s*전", m.group(3) or ""):
                date_iso = today
            else:
                continue
        if date_iso > today or len(re.findall(r"[가-힣]", title)) < 3:
            continue
        key = f"{href}|{title}"
        items.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "sourceName": "수만휘",
                "title": title[:140],
                "preview": strip_tags(m.group(3))[:120] or "수만휘 카페 글",
                "url": href,
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )
    uniq = {}
    for it in items:
        uniq[f"{it['url']}|{it['title']}"] = it
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_ITEMS]


def scrape(today: str) -> list:
    try:
        items = fetch_api(today)
        if items:
            return items
    except Exception as e:
        print(f"warn: naver api failed: {e}")
    text = fetch_page_fallback()
    if not text:
        raise RuntimeError("empty page")
    return parse_fallback(text, today)


def main():
    js_path = ROOT / "suhui-board-data.js"
    json_path = ROOT / "data" / "suhui-notices.json"
    previous = load_previous(json_path, js_path)
    today = seoul_today()
    kept_prev = False
    reason = "ok"
    try:
        notices = scrape(today)
        notices, reason = keep_previous_if_weak(new_notices=notices, previous=previous, min_absolute=2)
        kept_prev = reason.startswith("keep_prev")
    except Exception as e:
        print(f"error: suhui scrape failed: {e}")
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
        "source": SOURCE,
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
    write_board(js_path=js_path, json_path=json_path, global_name="SUHUI_BOARD_DATA", payload=payload)
    print(f"wrote {len(notices)} suhui items ({payload['statusReason']})")
    for n in notices[:6]:
        print(n["dateISO"], n["title"][:48], n["url"][:60])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        for path in (ROOT / "data" / "suhui-notices.json", ROOT / "suhui-board-data.js"):
            if path.exists() and path.stat().st_size > 80:
                print(f"fatal retained previous: {e}")
                raise SystemExit(0)
        raise
