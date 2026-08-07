# -*- coding: utf-8 -*-
"""다음 카페 '사립학교 정교사' → teacher-board-data.js / data/teacher-notices.json

링크 없이 제목·미리보기·날짜만 저장.
모바일 API: /api/v1/common-articles
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _board_io import (  # noqa: E402
    fetch_text,
    keep_previous_if_weak,
    load_previous,
    utc_now_iso,
    write_board,
)

SOURCE = "https://cafe.daum.net/applymate/Alvz"
GRPID = "1YpPw"
FLDID = "Alvz"
API = "https://m.cafe.daum.net/api/v1/common-articles"
DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
MAX_ITEMS = 40


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
    s = unescape(html or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def elapsed_to_iso(elapsed: str, today: str) -> str:
    """'57분 전', '1시간 27분 전', '어제', '3일 전' → YYYY-MM-DD"""
    s = strip_tags(elapsed)
    if not s:
        return today
    if "방금" in s or "분 전" in s or "시간" in s or s == "오늘":
        return today
    if "어제" in s:
        return (seoul_now() - timedelta(days=1)).strftime("%Y-%m-%d")
    m = re.search(r"(\d+)\s*일\s*전", s)
    if m:
        return (seoul_now() - timedelta(days=int(m.group(1)))).strftime("%Y-%m-%d")
    m = re.search(r"(\d+)\s*주\s*전", s)
    if m:
        return (seoul_now() - timedelta(weeks=int(m.group(1)))).strftime("%Y-%m-%d")
    iso = extract_date(s)
    return iso or today


def fetch_api(today: str) -> list:
    params = urlencode(
        {
            "grpid": GRPID,
            "fldid": FLDID,
            "targetPage": 1,
            "pageSize": MAX_ITEMS,
        }
    )
    raw = fetch_text(
        f"{API}?{params}",
        headers={
            "Accept": "application/json,*/*",
            "Referer": "https://m.cafe.daum.net/applymate/Alvz",
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            ),
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=20,
        retries=3,
    )
    data = json.loads(raw)
    articles = data.get("articles") if isinstance(data, dict) else None
    if not isinstance(articles, list):
        raise RuntimeError("api: no articles")
    items = []
    for art in articles:
        if not isinstance(art, dict):
            continue
        title = strip_tags(str(art.get("title") or ""))
        title = re.sub(r"^(새글|N|NEW|공지)\s*", "", title, flags=re.I).strip()
        if not title or len(title) < 4:
            continue
        date_iso = elapsed_to_iso(str(art.get("articleElapsedTime") or ""), today)
        if not date_iso or date_iso > today:
            continue
        preview = strip_tags(str(art.get("headCont") or ""))[:120] or "사립학교 정교사 카페 글"
        dataid = art.get("dataid") or ""
        key = f"{dataid}|{title}|{date_iso}"
        items.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "sourceName": "사립학교 정교사",
                "title": title[:140],
                "preview": preview,
                "url": "",
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )
    print(f"ok daum api {len(items)}")
    return items


def fetch_page_fallback() -> str:
    try:
        mirror = fetch_text(
            "https://r.jina.ai/" + SOURCE,
            headers={"Accept": "text/plain,*/*"},
            timeout=45,
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
        r"\[([^\]]{8,120})\]\((https?://[^)]+)\)([\s\S]{0,220}?)",
        text,
    ):
        title = strip_tags(m.group(1))
        date_iso = extract_date(m.group(0)) or extract_date(m.group(3))
        if not date_iso or date_iso > today:
            continue
        if len(re.findall(r"[가-힣]", title)) < 4:
            continue
        key = f"{title}|{date_iso}"
        items.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "sourceName": "사립학교 정교사",
                "title": title[:140],
                "preview": strip_tags(m.group(3))[:120] or "사립학교 정교사 카페 글",
                "url": "",
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
            }
        )
    uniq = {}
    for it in items:
        uniq[f"{it['title']}|{it['dateISO']}"] = it
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_ITEMS]


def scrape(today: str) -> list:
    try:
        items = fetch_api(today)
        if items:
            return items[:MAX_ITEMS]
    except Exception as e:
        print(f"warn: daum api failed: {e}")
    text = fetch_page_fallback()
    if not text:
        raise RuntimeError("empty page")
    return parse_fallback(text, today)


def main():
    js_path = ROOT / "teacher-board-data.js"
    json_path = ROOT / "data" / "teacher-notices.json"
    previous = load_previous(json_path, js_path)
    today = seoul_today()
    kept_prev = False
    reason = "ok"
    try:
        notices = scrape(today)
        notices, reason = keep_previous_if_weak(new_notices=notices, previous=previous, min_absolute=2)
        kept_prev = reason.startswith("keep_prev")
    except Exception as e:
        print(f"error: teacher cafe scrape failed: {e}")
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
    write_board(js_path=js_path, json_path=json_path, global_name="TEACHER_BOARD_DATA", payload=payload)
    print(f"wrote {len(notices)} teacher cafe items ({payload['statusReason']})")
    for n in notices[:6]:
        print(n["dateISO"], n["title"][:50])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        js_path = ROOT / "teacher-board-data.js"
        json_path = ROOT / "data" / "teacher-notices.json"
        for path in (json_path, js_path):
            if path.exists() and path.stat().st_size > 80:
                print(f"fatal retained previous: {e}")
                raise SystemExit(0)
        raise
