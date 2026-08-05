# -*- coding: utf-8 -*-
"""진학프로 석박 채용 정보 수집 → recruit-board-data.js / data/recruit-notices.json

정확성 우선:
- 등록일·마감일·기관명·제목은 목록 페이지 __NUXT_DATA__에서 해석
- HTML 카드는 미리보기(유형·지역·지원방법) 보조
- 수집 실패 시 이전 데이터를 유지하고 exit 0 (Actions가 깨지지 않음)
"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _board_io import load_board, looks_blocked, notice_count, write_board

ROOT = Path(__file__).resolve().parent.parent
LIST_URL = "https://www.jinhakpro.com/recruit/list"
JS_NAME = "recruit-board-data.js"
GLOBAL_NAME = "RECRUIT_BOARD_DATA"
JSON_REL = "data/recruit-notices.json"
CTX = ssl._create_unverified_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DATE_DOT = re.compile(r"(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})")


def fetch(url: str, timeout: int = 45) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Referer": "https://www.jinhakpro.com/",
        },
    )
    with urlopen(req, context=CTX, timeout=timeout) as res:
        return res.read().decode("utf-8", "ignore")


def fetch_with_retries(url: str, attempts: int = 4) -> str:
    last_err = ""
    for i in range(attempts):
        try:
            html = fetch(url)
            if looks_blocked(html):
                last_err = "blocked"
                print(f"fetch attempt {i + 1}/{attempts}: blocked/security check")
            elif "__NUXT_DATA__" not in html and 'href="/recruit/' not in html:
                last_err = "unexpected_html"
                print(f"fetch attempt {i + 1}/{attempts}: unexpected html len={len(html)}")
            else:
                return html
        except (HTTPError, URLError, TimeoutError, OSError) as e:
            last_err = type(e).__name__
            print(f"fetch attempt {i + 1}/{attempts}: {last_err}: {e}")
        time.sleep(1.2 * (i + 1))
    raise RuntimeError(f"fetch_failed:{last_err}")


def strip_tags(html: str) -> str:
    s = unescape(html or "")
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def to_iso(y, mo, d) -> str:
    try:
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""


def short_univ(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "")).strip()
    if re.search(r"[가-힣]", n):
        compact = n.replace(" ", "")
        compact = compact.replace("대학교", "대").replace("대학", "대")
        return compact
    return n


def date_only(val) -> str:
    s = str(val or "").strip()
    m = re.match(r"(20\d{2}-\d{2}-\d{2})", s)
    return m.group(1) if m else ""


def seoul_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")


def dday_label(deadline_iso: str, today: str) -> str:
    if not deadline_iso or not today:
        return ""
    try:
        d0 = datetime.strptime(today, "%Y-%m-%d").date()
        d1 = datetime.strptime(deadline_iso, "%Y-%m-%d").date()
    except ValueError:
        return ""
    diff = (d1 - d0).days
    if diff > 0:
        return f"D-{diff}"
    if diff == 0:
        return "D-Day"
    return f"마감+{abs(diff)}"


def load_nuxt_data(html: str):
    m = re.search(
        r'<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)</script>',
        html or "",
    )
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def resolve(data, ref):
    if isinstance(ref, int) and 0 <= ref < len(data):
        return data[ref]
    return ref


def parse_nuxt_recruits(html: str) -> dict:
    data = load_nuxt_data(html)
    if not data:
        return {}
    out = {}
    for item in data:
        if not isinstance(item, dict) or "recruitIdx" not in item:
            continue
        rid = resolve(data, item.get("recruitIdx"))
        if not isinstance(rid, int):
            continue
        title = resolve(data, item.get("recruitTitle"))
        organ = resolve(data, item.get("organName"))
        register = date_only(resolve(data, item.get("registerTime")))
        publish_start = date_only(resolve(data, item.get("publishStartTime")))
        apply_start = date_only(resolve(data, item.get("applyStartTime")))
        apply_end = date_only(
            resolve(data, item.get("applyEndTime") or item.get("applyEarlyEndTime"))
        )
        date_iso = register or publish_start or apply_start
        if not date_iso or not title:
            continue
        out[str(rid)] = {
            "title": str(title).strip(),
            "univFull": str(organ or "").strip(),
            "univName": short_univ(str(organ or "")) or str(organ or "").strip() or "기관",
            "dateISO": date_iso,
            "deadlineISO": apply_end or "",
            "registerISO": register,
            "publishStartISO": publish_start,
        }
    return out


def parse_cards(html: str) -> list:
    blocks = re.split(r'(?=<a[^>]+href="/recruit/\d+")', html or "")
    items = []
    seen = set()
    for b in blocks:
        hm = re.search(r'href="(/recruit/(\d+))"', b)
        if not hm:
            continue
        href, rid = hm.group(1), hm.group(2)
        if rid in seen:
            continue
        seen.add(rid)

        info_bits = []
        info_m = re.search(r'class="card_recr_info"[^>]*>([\s\S]*?)</p>', b, re.I)
        if info_m:
            info_bits = [
                strip_tags(x)
                for x in re.findall(r"<span[^>]*>([\s\S]*?)</span>", info_m.group(1), re.I)
            ]
            info_bits = [x for x in info_bits if x and x not in ("스크랩", "관심 스크랩")]

        tags = [
            strip_tags(x)
            for x in re.findall(r'class="card_ctg"[^>]*>([\s\S]*?)</p>', b, re.I)
        ]
        tags = [x for x in tags if x and x != "마감임박"]

        period_m = re.search(r'class="card_period"[^>]*>([\s\S]*?)</p>', b, re.I)
        period_raw = period_m.group(1) if period_m else ""
        deadline_dot = ""
        pm = DATE_DOT.search(period_raw)
        if pm:
            deadline_dot = to_iso(pm.group(1), pm.group(2), pm.group(3))

        items.append(
            {
                "id": rid,
                "url": "https://www.jinhakpro.com" + href,
                "tags": tags,
                "infoBits": info_bits,
                "deadlineISO": deadline_dot,
                "listOrder": len(items),
            }
        )
    return items


def build_preview(tags, info_bits, deadline_iso: str, today: str) -> str:
    parts = []
    if tags:
        parts.append(" · ".join(tags[:3]))
    if info_bits:
        parts.append(" · ".join(info_bits[:3]))
    dd = dday_label(deadline_iso, today)
    if dd:
        parts.append(f"마감 {dd}")
    if deadline_iso:
        parts.append(f"접수마감 {deadline_iso.replace('-', '.')}")
    return " · ".join(parts) if parts else "석·박사 채용 정보"


def build_notices(html: str, today: str) -> list:
    nuxt = parse_nuxt_recruits(html)
    cards = parse_cards(html)
    print(f"cards={len(cards)} nuxt_recruits={len(nuxt)}")
    notices = []
    missing = []
    for c in cards:
        rid = c["id"]
        meta = nuxt.get(rid)
        if not meta:
            missing.append(rid)
            continue
        date_iso = meta["dateISO"]
        if date_iso > today:
            print(f"skip future date {rid} {date_iso}")
            continue
        deadline = meta.get("deadlineISO") or c.get("deadlineISO") or ""
        title = meta["title"]
        if len(title) < 4:
            continue
        preview = build_preview(c.get("tags") or [], c.get("infoBits") or [], deadline, today)
        key = f"{rid}|{title}|{date_iso}"
        notices.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "recruitId": rid,
                "univName": meta["univName"],
                "univFull": meta["univFull"] or meta["univName"],
                "title": title,
                "preview": preview[:160],
                "url": c["url"],
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
                "deadlineISO": deadline,
                "deadlineText": deadline.replace("-", ".") if deadline else "",
                "listOrder": c["listOrder"],
            }
        )
    if missing:
        print(f"warning: {len(missing)} cards without nuxt meta:", missing[:12])
    notices.sort(key=lambda x: (x["dateISO"], -x["listOrder"]), reverse=True)
    for n in notices:
        n.pop("listOrder", None)
    return notices


def keep_previous(reason: str) -> int:
    prev = load_board(ROOT, JS_NAME, GLOBAL_NAME, JSON_REL)
    n = notice_count(prev)
    if n > 0:
        print(f"KEEP previous recruit data ({n} items) — {reason}")
        return 0
    print(f"ERROR no previous recruit data and scrape failed — {reason}", file=sys.stderr)
    return 0  # Actions를 깨지 않음. 화면은 번들/빈 상태 유지.


def main() -> int:
    today = seoul_today()
    try:
        html = fetch_with_retries(LIST_URL)
        notices = build_notices(html, today)
    except Exception as e:
        print(f"recruit scrape failed: {type(e).__name__}: {e}")
        return keep_previous(str(e))

    if len(notices) < 3:
        return keep_previous(f"too_few_items:{len(notices)}")

    payload = {
        "source": LIST_URL,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "today": today,
        "count": len(notices),
        "notices": notices,
    }
    write_board(ROOT, JS_NAME, GLOBAL_NAME, JSON_REL, payload)
    print(f"wrote {len(notices)} items → {JS_NAME}, {JSON_REL}")
    for n in notices[:8]:
        print(n["dateISO"], n["deadlineISO"], n["univName"], "|", n["title"][:42])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
