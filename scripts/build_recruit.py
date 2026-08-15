# -*- coding: utf-8 -*-
"""진학프로 석박 채용 정보 수집 → recruit-board-data.js / data/recruit-notices.json

우선순위:
1) /api/applicant/recruit/sub-list (목록과 동일 소스, Actions에서 안정)
2) https://www.jinhakpro.com/recruit/list 의 __NUXT_DATA__ 폴백
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from _board_io import load_previous, utc_now_iso, write_board  # noqa: E402

LIST_URL = "https://www.jinhakpro.com/recruit/list"
API_URL = (
    "https://www.jinhakpro.com/api/applicant/recruit/sub-list"
    "?isOnlyOnlineApply=false&bookmarkSortType=1&majorCategoryCode=&sortType=1"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
RECRUIT_TYPE = {"RS": "연구원", "L": "강사", "T": "비전임교원", "P": "전임교원"}
RECRUIT_METHOD = {
    "H": "홈페이지지원",
    "E": "이메일지원",
    "P": "우편지원",
    "V": "방문지원",
    "O": "즉시지원",
}
RECRUIT_ORGAN = {
    "UNIV": "대학교",
    "UNIV1": "대학교",
    "UNIV2": "전문대학",
    "UNIV3": "사이버대학교",
    "RS1": "연구기관",
    "CO": "기업",
    "HOSP": "병원",
    "GOV": "정부/공공/지자체",
}


def seoul_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")


def seoul_date_from_iso(val) -> str:
    s = str(val or "").strip()
    if not s:
        return ""
    try:
        if s.endswith("Z"):
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        elif re.match(r"20\d{2}-\d{2}-\d{2}$", s):
            return s
        else:
            dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt.astimezone(timezone(timedelta(hours=9)))).strftime("%Y-%m-%d")
    except Exception:
        m = re.match(r"(20\d{2}-\d{2}-\d{2})", s)
        return m.group(1) if m else ""


def short_univ(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "")).strip()
    if re.search(r"[가-힣]", n):
        compact = n.replace(" ", "")
        compact = compact.replace("대학교", "대").replace("대학", "대")
        return compact
    return n


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
    return ""


def add_days(iso: str, delta: int) -> str:
    try:
        d = datetime.strptime(iso, "%Y-%m-%d").date() + timedelta(days=delta)
        return d.strftime("%Y-%m-%d")
    except Exception:
        return iso


def http_get(url: str, accept: str, timeout: int = 45) -> str:
    """GET with Chrome-impersonation fallback (Actions/Cloudflare 우회)."""
    headers = {
        "User-Agent": UA,
        "Accept": accept,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": LIST_URL,
        "Origin": "https://www.jinhakpro.com",
        "Cache-Control": "no-cache",
    }

    # 1) curl_cffi — GitHub Actions IP에서 Cloudflare 우회에 유리
    try:
        from curl_cffi import requests as cf_requests  # type: ignore

        res = cf_requests.get(
            url,
            headers=headers,
            timeout=timeout,
            impersonate="chrome124",
            allow_redirects=True,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"http_{res.status_code}")
        text = res.text or ""
        if text:
            return text
    except Exception as e:
        print(f"warn: curl_cffi fetch failed: {e}")

    # 2) 표준 urllib
    from _board_io import CTX

    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, context=CTX, timeout=timeout) as res:
        return res.read().decode("utf-8", "replace")


def fetch_api_items() -> list:
    last_err: Exception | None = None
    for i in range(5):
        try:
            raw = http_get(url=API_URL, accept="application/json,text/plain,*/*")
            if re.search(r"just a moment|cloudflare|cf-browser-verification", raw, re.I):
                raise RuntimeError("cloudflare_challenge")
            data = json.loads(raw)
            if not isinstance(data, list) or not data:
                raise RuntimeError("api_empty")
            if not data[0].get("recruitIdx") or not data[0].get("recruitTitle"):
                raise RuntimeError("api_shape")
            return data
        except Exception as e:
            last_err = e
            print(f"warn: api attempt {i + 1} failed: {e}")
            time.sleep(0.7 * (i + 1))
    raise RuntimeError(f"recruit api failed: {last_err}")


def fetch_list_html() -> str:
    try:
        html = http_get(url=LIST_URL, accept="text/html,application/xhtml+xml")
        if len(html) > 800 and "__NUXT_DATA__" in html and not (
            "Security Check" in html and len(html) < 5000
        ):
            return html
        print("warn: thin/blocked direct html, trying jina")
    except Exception as e:
        print(f"warn: direct html failed: {e}")
    mirror = http_get(url="https://r.jina.ai/" + LIST_URL, accept="text/plain,*/*", timeout=60)
    if len(mirror) < 400:
        raise RuntimeError("jina empty")
    if "just a moment" in mirror.lower():
        raise RuntimeError("jina cloudflare")
    return mirror


def resolve(data, ref):
    if isinstance(ref, int) and 0 <= ref < len(data):
        return data[ref]
    return ref


def parse_nuxt_items(html: str) -> list:
    m = re.search(
        r'<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)</script>',
        html or "",
    )
    if not m:
        return []
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []

    for item in data:
        if not isinstance(item, dict):
            continue
        for k, v in item.items():
            if "/applicant/recruit/sub-list" not in str(k):
                continue
            arr = resolve(data, v)
            if not isinstance(arr, list) or not arr:
                continue
            out = []
            for ref in arr:
                obj = resolve(data, ref)
                if not isinstance(obj, dict):
                    continue
                out.append(
                    {
                        "recruitIdx": resolve(data, obj.get("recruitIdx")),
                        "recruitTitle": resolve(data, obj.get("recruitTitle")),
                        "recruitTypeCode": resolve(data, obj.get("recruitTypeCode")),
                        "registerTime": resolve(data, obj.get("registerTime")),
                        "publishStartTime": resolve(data, obj.get("publishStartTime")),
                        "applyStartTime": resolve(data, obj.get("applyStartTime")),
                        "applyEndTime": resolve(data, obj.get("applyEndTime")),
                        "applyEarlyEndTime": resolve(data, obj.get("applyEarlyEndTime")),
                        "applyMethodCode": resolve(data, obj.get("applyMethodCode")),
                        "regionData": resolve(data, obj.get("regionData")),
                        "organName": resolve(data, obj.get("organName")),
                        "organTypeCode": resolve(data, obj.get("organTypeCode")),
                        "organCode": resolve(data, obj.get("organCode")),
                    }
                )
            if out:
                return out
    return []


def preview_from_item(item: dict, deadline_iso: str, today: str) -> str:
    typ = RECRUIT_TYPE.get(str(item.get("recruitTypeCode") or "").upper(), "")
    regions = []
    for r in item.get("regionData") or []:
        if isinstance(r, dict):
            name = str(r.get("region") or "").strip()
            if name:
                regions.append(name)
    if len(regions) == 1:
        region = regions[0]
    elif len(regions) > 1:
        region = f"{regions[0]} 외 {len(regions) - 1}"
    else:
        region = ""
    methods = [
        RECRUIT_METHOD.get(str(c or "").upper(), "")
        for c in (item.get("applyMethodCode") or [])
    ]
    methods = [m for m in methods if m]
    organ = RECRUIT_ORGAN.get(str(item.get("organCode") or "").upper()) or RECRUIT_ORGAN.get(
        str(item.get("organTypeCode") or "").upper(), ""
    )
    parts = []
    if typ:
        parts.append(typ)
    if region:
        parts.append(region)
    if methods:
        parts.append("/".join(methods[:3]))
    if organ:
        parts.append(organ)
    dd = dday_label(deadline_iso, today)
    if dd:
        parts.append(f"마감 {dd}")
    if deadline_iso:
        parts.append(f"접수마감 {deadline_iso.replace('-', '.')}")
    return " · ".join(parts) if parts else "석·박사 채용 정보"


def notices_from_items(items: list, today: str) -> list:
    rows = []
    for item in items or []:
        rid = item.get("recruitIdx")
        if rid is None:
            continue
        rid_s = str(rid)
        title = re.sub(r"\s+", " ", str(item.get("recruitTitle") or "")).strip()
        organ = re.sub(r"\s+", " ", str(item.get("organName") or "")).strip()
        if len(title) < 4:
            continue
        register_iso = seoul_date_from_iso(item.get("registerTime"))
        publish_iso = seoul_date_from_iso(item.get("publishStartTime"))
        apply_start = seoul_date_from_iso(item.get("applyStartTime"))
        date_iso = register_iso or publish_iso or apply_start
        if not date_iso or date_iso > today:
            continue
        deadline = seoul_date_from_iso(item.get("applyEndTime")) or seoul_date_from_iso(
            item.get("applyEarlyEndTime")
        )
        univ_name = short_univ(organ) or organ or "기관"
        key = f"{rid_s}|{title}|{date_iso}"
        rows.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "recruitId": rid_s,
                "univName": univ_name,
                "univFull": organ or univ_name,
                "title": title,
                "preview": preview_from_item(item, deadline, today)[:160],
                "url": f"https://www.jinhakpro.com/recruit/{rid_s}",
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
                "deadlineISO": deadline,
                "deadlineText": deadline.replace("-", ".") if deadline else "",
                "registerAt": str(item.get("registerTime") or ""),
            }
        )
    rows.sort(key=lambda x: (x["dateISO"], x["registerAt"]), reverse=True)
    min_date = add_days(today, -3)
    recent = [r for r in rows if r["dateISO"] >= min_date]
    picked = (recent if len(recent) >= 12 else rows)[:48]
    for n in picked:
        n.pop("registerAt", None)
    return picked


def main() -> None:
    strict = "--strict" in sys.argv
    js_path = ROOT / "recruit-board-data.js"
    json_path = ROOT / "data" / "recruit-notices.json"
    previous = load_previous(json_path, js_path)
    today = seoul_today()
    source_mode = "api"

    try:
        try:
            items = fetch_api_items()
            print(f"recruit api items={len(items)}")
        except Exception as e:
            print(f"warn: api failed, html/nuxt fallback: {e}")
            html = fetch_list_html()
            items = parse_nuxt_items(html)
            source_mode = "html_nuxt"
            print(f"recruit html/nuxt items={len(items)}")
        notices = notices_from_items(items, today)
        if not notices:
            raise RuntimeError("recruit empty parse")
        payload = {
            "source": LIST_URL,
            "api": API_URL,
            "updatedAt": utc_now_iso(),
            "checkedAt": utc_now_iso(),
            "today": today,
            "count": len(notices),
            "notices": notices,
            "stale": False,
            "status": "fresh",
            "statusReason": f"ok:{source_mode}",
        }
    except Exception as e:
        print(f"error: recruit scrape failed: {e}")
        if strict or not previous or not previous.get("notices"):
            raise SystemExit(f"recruit scrape failed: {e}")
        notices = previous["notices"]
        payload = {
            "source": LIST_URL,
            "api": API_URL,
            "updatedAt": previous.get("updatedAt") or utc_now_iso(),
            "checkedAt": utc_now_iso(),
            "today": today,
            "count": len(notices),
            "notices": notices,
            "stale": True,
            "status": "cached",
            "statusReason": f"keep_prev_exception:{type(e).__name__}",
        }

    write_board(
        js_path=js_path,
        json_path=json_path,
        global_name="RECRUIT_BOARD_DATA",
        payload=payload,
    )
    print(
        f"wrote {payload['count']} items → {js_path.name}, {json_path.as_posix()} ({payload['statusReason']})"
    )
    for n in payload["notices"][:8]:
        print(n["dateISO"], n.get("deadlineISO", ""), n["univName"], "|", n["title"][:42])


if __name__ == "__main__":
    main()
