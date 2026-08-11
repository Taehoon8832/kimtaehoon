# -*- coding: utf-8 -*-
"""진학프로 석박 채용 정보 수집 → recruit-board-data.js / data/recruit-notices.json

정확성 우선:
- 등록일·마감일·기관명·제목은 목록 페이지 __NUXT_DATA__에서 해석
- HTML 카드는 미리보기(유형·지역·지원방법) 보조
- 이웃 날짜 보간·추측 날짜 사용 금지
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _board_io import (  # noqa: E402
    fetch_text,
    keep_previous_if_weak,
    load_previous,
    utc_now_iso,
    write_board,
)

LIST_URL = "https://www.jinhakpro.com/recruit/list"
DATE_DOT = re.compile(r"(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})")


def fetch(url: str) -> str:
    return fetch_text(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "Referer": "https://www.jinhakpro.com/",
        },
        timeout=45,
        retries=4,
    )


def fetch_list_html() -> str:
    """직접 접속 실패·보안차단 시 Jina 미러로 폴백."""
    try:
        html = fetch(LIST_URL)
        if "Security Check" in html and len(html) < 5000:
            print("warn: security check on direct fetch, trying jina")
        elif len(html) > 800 and ("__NUXT_DATA__" in html or "/recruit/" in html):
            return html
        else:
            print("warn: thin direct html, trying jina")
    except Exception as e:
        print(f"warn: direct fetch failed: {e}")

    try:
        mirror = fetch_text(
            "https://r.jina.ai/" + LIST_URL,
            headers={"Accept": "text/plain,*/*"},
            timeout=60,
            retries=3,
        )
        if len(mirror) > 400:
            return mirror
    except Exception as e:
        print(f"warn: jina fetch failed: {e}")
    return ""


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
    """'2026-08-04T03:00:47.692Z' / '2026-08-04 03:00:47' → YYYY-MM-DD"""
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
    """recruitId(str) → 정확한 메타데이터."""
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
        # 게시일 = 등록일(registerTime). 없으면 publishStart.
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
    """HTML 카드에서 목록 순서·미리보기 보조 정보."""
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
        print(f"warning: {len(missing)} cards without nuxt meta:", missing)

    notices.sort(key=lambda x: (x["dateISO"], -x["listOrder"]), reverse=True)
    for n in notices:
        n.pop("listOrder", None)
    return notices


def main():
    js_path = ROOT / "recruit-board-data.js"
    json_path = ROOT / "data" / "recruit-notices.json"
    previous = load_previous(json_path, js_path)
    today = seoul_today()
    kept_prev = False
    reason = "ok"

    try:
        html = fetch_list_html()
        if not html:
            raise RuntimeError("empty list html")
        if "Security Check" in html and len(html) < 5000 and "__NUXT_DATA__" not in html:
            raise RuntimeError("blocked by security check")
        notices = build_notices(html, today)
        notices, reason = keep_previous_if_weak(new_notices=notices, previous=previous)
        kept_prev = reason.startswith("keep_prev")
    except Exception as e:
        print(f"error: recruit scrape failed: {e}")
        if previous and isinstance(previous.get("notices"), list) and previous["notices"]:
            notices = previous["notices"]
            kept_prev = True
            reason = f"keep_prev_exception:{type(e).__name__}"
        else:
            raise SystemExit(f"recruit scrape failed with no previous data: {e}")

    day_changed = bool(previous) and previous.get("today") != today
    # 목록이 같아도 checkedAt/today는 매번 갱신해 Actions·프론트 생존 신호를 유지

    if day_changed:
        refreshed = []
        for n in notices:
            item = dict(n)
            deadline = str(item.get("deadlineISO") or "")
            # 미리보기 꼬리의 D-day만 오늘 기준으로 다시 붙임
            base = re.sub(r"(?:^|\s*·\s*)마감\s+(?:D-\d+|D-Day|마감\+\d+)\s*", " · ", str(item.get("preview") or ""))
            base = re.sub(r"\s*·\s*·\s*", " · ", base).strip(" ·")
            dd = dday_label(deadline, today)
            bits = [p for p in re.split(r"\s*·\s*", base) if p]
            if dd:
                bits.append(f"마감 {dd}")
            if deadline and not any(p.startswith("접수마감") for p in bits):
                bits.append(f"접수마감 {deadline.replace('-', '.')}")
            item["preview"] = " · ".join(bits)[:160] if bits else str(item.get("preview") or "석·박사 채용 정보")
            refreshed.append(item)
        notices = refreshed

    payload = {
        "source": LIST_URL,
        "updatedAt": previous.get("updatedAt") if kept_prev and previous else utc_now_iso(),
        "checkedAt": utc_now_iso(),
        "today": today,
        "count": len(notices),
        "notices": notices,
        "stale": bool(kept_prev),
        "status": "cached" if kept_prev else "fresh",
        "statusReason": reason if not day_changed else f"{reason};day_rollover",
    }
    if not kept_prev:
        payload["updatedAt"] = utc_now_iso()

    write_board(
        js_path=js_path,
        json_path=json_path,
        global_name="RECRUIT_BOARD_DATA",
        payload=payload,
    )
    print(f"wrote {len(notices)} items → {js_path.name}, {json_path.as_posix()} ({payload['statusReason']})")
    for n in notices[:8]:
        print(n["dateISO"], n.get("deadlineISO", ""), n["univName"], "|", n["title"][:42])


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        js_path = ROOT / "recruit-board-data.js"
        json_path = ROOT / "data" / "recruit-notices.json"
        for path in (json_path, js_path):
            if path.exists() and path.stat().st_size > 100:
                print(f"fatal retained previous board data after error: {e}")
                raise SystemExit(0)
        raise
