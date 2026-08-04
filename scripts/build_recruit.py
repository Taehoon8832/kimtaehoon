# -*- coding: utf-8 -*-
"""진학프로 석박 채용 정보 수집 → recruit-board-data.js / data/recruit-notices.json"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
LIST_URL = "https://www.jinhakpro.com/recruit/list"
CTX = ssl._create_unverified_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
DATE_DOT = re.compile(r"(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})")
ISO_TS = r"20\d{2}-\d{2}-\d{2}T[^\"']*"


def fetch(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
    )
    with urlopen(req, context=CTX, timeout=45) as res:
        return res.read().decode("utf-8", "ignore")


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


def parse_nuxt_dates(html: str) -> dict:
    """id → {deadline, created} from Nuxt payload fragments.

    두 형태가 섞여 있음:
      45716,"제목",false,"deadlineISO","createdISO",...
      45728,"제목","deadlineISO","createdISO","updatedISO",...
    """
    out = {}
    html = html or ""

    pat_bool = re.compile(
        rf'(\d{{4,6}}),"([^"\\]{{4,240}})",(true|false),"({ISO_TS})","({ISO_TS})"'
    )
    for m in pat_bool.finditer(html):
        rid, _title, closed, deadline, created = m.groups()
        out[rid] = {
            "deadline": deadline[:10],
            "created": created[:10],
            "closed": closed == "true",
        }

    pat_str = re.compile(
        rf'(\d{{4,6}}),"([^"\\]{{4,240}})","({ISO_TS})","({ISO_TS})","({ISO_TS})"'
    )
    for m in pat_str.finditer(html):
        rid, _title, deadline, created, _updated = m.groups()
        if rid in out:
            continue
        out[rid] = {
            "deadline": deadline[:10],
            "created": created[:10],
            "closed": False,
        }
    return out


def parse_detail_dates(html: str) -> dict:
    """상세 페이지에서 deadline / 등록·시작일 추정."""
    pairs = re.findall(
        rf'"({ISO_TS})","({ISO_TS})"',
        html or "",
    )
    for a, b in pairs:
        # 마감일이 등록/시작일보다 뒤인 쌍
        if a[:10] >= b[:10] and a[:10] >= "2020-01-01":
            return {"deadline": a[:10], "created": b[:10]}
    stamps = re.findall(r"(20\d{2}-\d{2}-\d{2})T", html or "")
    stamps = [s for s in stamps if s >= "2020-01-01"]
    if len(stamps) >= 2:
        # 페이지 로드 시각 제외: .000Z / :59 쪽이 마감인 경우 많음
        return {"deadline": stamps[0], "created": stamps[1]}
    return {}


def fetch_detail_meta(rid: str) -> dict:
    url = f"https://www.jinhakpro.com/recruit/{rid}"
    try:
        html = fetch(url)
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        print(f"detail fail {rid}: {e}")
        return {}
    return parse_detail_dates(html)


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

        univ = ""
        for am in re.finditer(r'alt="([^"]+)"', b):
            cand = unescape(am.group(1)).strip()
            if any(
                k in cand
                for k in ("대학", "학교", "대학원", "연구소", "센터", "University", "College", "Institute")
            ) or cand.endswith("대"):
                univ = cand
                break
        if not univ:
            am = re.search(r'alt="([^"]+)"', b)
            univ = unescape(am.group(1)).strip() if am else ""

        tit_m = re.search(r'class="card_recr_tit"[^>]*>([\s\S]*?)</', b, re.I)
        title = strip_tags(tit_m.group(1)) if tit_m else ""
        if len(title) < 6:
            continue

        info_m = re.search(r'class="card_recr_info"[^>]*>([\s\S]*?)</p>', b, re.I)
        info_bits = []
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
        dday = ""
        dm = re.search(r"D-?\d+", period_raw, re.I)
        if dm:
            dday = dm.group(0)
        deadline_dot = ""
        pm = DATE_DOT.search(period_raw)
        if pm:
            deadline_dot = to_iso(pm.group(1), pm.group(2), pm.group(3))

        preview_parts = []
        if tags:
            preview_parts.append(" · ".join(tags[:3]))
        if info_bits:
            preview_parts.append(" · ".join(info_bits[:3]))
        if dday:
            preview_parts.append(f"마감 {dday}")
        preview = " · ".join(preview_parts) if preview_parts else "석·박사 채용 정보"

        items.append(
            {
                "id": rid,
                "univName": short_univ(univ) or univ or "기관",
                "univFull": univ,
                "title": title,
                "preview": preview[:140],
                "url": "https://www.jinhakpro.com" + href,
                "deadlineISO": deadline_dot,
                "listOrder": len(items),
            }
        )
    return items


def fill_missing_dates(notices: list, dates: dict) -> None:
    """목록 Nuxt에 없는 등록일은 상세 페이지에서 보완."""
    missing = [n for n in notices if not n.get("_created")]
    if not missing:
        return
    print(f"fetching detail dates for {len(missing)} items…")
    for i, n in enumerate(missing):
        meta = fetch_detail_meta(n["recruitId"])
        if meta.get("created"):
            n["_created"] = meta["created"]
            n["dateISO"] = meta["created"]
            n["dateText"] = meta["created"].replace("-", ".")
        if meta.get("deadline") and not n.get("deadlineISO"):
            n["deadlineISO"] = meta["deadline"]
            n["deadlineText"] = meta["deadline"].replace("-", ".")
        if i < len(missing) - 1:
            time.sleep(0.35)


def main():
    html = fetch(LIST_URL)
    if "Security Check" in html and len(html) < 5000:
        raise SystemExit("blocked by security check")
    cards = parse_cards(html)
    dates = parse_nuxt_dates(html)
    print(f"cards={len(cards)} nuxt_dates={len(dates)}")

    notices = []
    for c in cards:
        meta = dates.get(c["id"], {})
        created = meta.get("created") or ""
        deadline = meta.get("deadline") or c.get("deadlineISO") or ""
        preview = c["preview"]
        if deadline and deadline not in preview:
            preview = f"{preview} · 접수마감 {deadline.replace('-', '.')}"
        key = f"{c['id']}|{c['title']}"
        notices.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "recruitId": c["id"],
                "univName": c["univName"],
                "univFull": c.get("univFull") or c["univName"],
                "title": c["title"],
                "preview": preview[:160],
                "url": c["url"],
                "dateISO": created or "",
                "dateText": created.replace("-", ".") if created else "",
                "deadlineISO": deadline,
                "deadlineText": deadline.replace("-", ".") if deadline else "",
                "listOrder": c["listOrder"],
                "_created": created,
            }
        )

    fill_missing_dates(notices, dates)

    # 이웃 등록일로 남은 빈칸 보간 (목록이 최신순이므로 인접 날짜 사용)
    for i, n in enumerate(notices):
        if n["dateISO"]:
            continue
        prev = next((x["dateISO"] for x in reversed(notices[:i]) if x["dateISO"]), "")
        nxt = next((x["dateISO"] for x in notices[i + 1 :] if x["dateISO"]), "")
        n["dateISO"] = prev or nxt or n.get("deadlineISO") or ""
        n["dateText"] = n["dateISO"].replace("-", ".") if n["dateISO"] else ""

    # 진학프로 목록 순서 유지(= 최신 등록 위)
    notices.sort(key=lambda x: x["listOrder"])
    for n in notices:
        n.pop("listOrder", None)
        n.pop("_created", None)

    today = (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")
    payload = {
        "source": LIST_URL,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "today": today,
        "count": len(notices),
        "notices": notices,
    }

    js_path = ROOT / "recruit-board-data.js"
    json_path = ROOT / "data" / "recruit-notices.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        "window.RECRUIT_BOARD_DATA="
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {len(notices)} items → {js_path.name}, {json_path.as_posix()}")
    for n in notices[:5]:
        print(n["dateISO"], n["univName"], "|", n["title"][:48])


if __name__ == "__main__":
    main()
