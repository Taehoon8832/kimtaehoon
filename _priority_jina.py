# -*- coding: utf-8 -*-
"""우선 대학 공지를 r.jina.ai 로 수집 (2026-08-01~)"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
MIN_DATE = "2026-08-01"
CTX = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"

MD = re.compile(
    r"\[([^\]]{6,160})\]\((https?://[^)\s]+)\)[\s\S]{0,120}?(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})"
)
TITLE_OK = re.compile(r"(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|설명회|시행|합격자)")
JUNK = re.compile(r"(var\s|function\s|javascript:|로그인|사이트맵)", re.I)


def load():
    raw = (ROOT / "univ-board-data.js").read_text(encoding="utf-8")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def jina(url: str) -> str:
    req = Request(
        "https://r.jina.ai/" + url,
        headers={"User-Agent": UA, "Accept": "text/plain"},
    )
    with urlopen(req, context=CTX, timeout=55) as res:
        return res.read().decode("utf-8", "ignore")


def parse(md: str, cfg: dict):
    out = []
    for m in MD.finditer(md or ""):
        title = re.sub(r"\s+", " ", m.group(1)).strip()
        url = m.group(2).split("#")[0]
        iso = f"{m.group(3)}-{int(m.group(4)):02d}-{int(m.group(5)):02d}"
        if iso < MIN_DATE:
            continue
        if JUNK.search(title) or len(re.findall(r"[가-힣]", title)) < 4:
            continue
        if not TITLE_OK.search(title) and "notice" not in url.lower():
            continue
        preview = f"{cfg['univName']} 입학처 전체 공지사항"
        key = f"{cfg['univId']}|{url}|{title}"
        out.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "univId": cfg["univId"],
                "univName": cfg["univName"],
                "title": title,
                "preview": preview,
                "url": url,
                "homeUrl": cfg["homeUrl"],
                "dateISO": iso,
                "dateText": iso.replace("-", "."),
                "priority": True,
            }
        )
    uniq = {x["url"] + "|" + x["title"]: x for x in out}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:5]


def main():
    payload = load()
    prio = payload.get("priority") or []
    found = []
    for cfg in prio:
        urls = []
        for u in (cfg.get("boardUrl"), cfg.get("homeUrl")):
            if u and u not in urls:
                urls.append(u)
        items = []
        for u in urls:
            try:
                md = jina(u)
                items = parse(md, cfg)
                print(("OK" if items else ".."), cfg["key"], len(items), u[:55])
                if items:
                    break
            except Exception as e:
                print("--", cfg["key"], type(e).__name__, str(e)[:60])
            time.sleep(1.1)
        found.extend(items)
        time.sleep(0.4)

    prio_ids = {c["univId"] for c in prio if c.get("univId")}
    other = [n for n in payload.get("notices", []) if n.get("univId") not in prio_ids]
    # keep previous priority notices that are still valid if jina missed
    old_prio = [
        n
        for n in payload.get("notices", [])
        if n.get("univId") in prio_ids
        and n.get("dateISO", "") >= MIN_DATE
        and not n.get("boardOnly")
    ]
    by_key = {}
    for n in old_prio + found:
        by_key[f"{n['univId']}|{n['url']}|{n['title']}"] = n
    prio_notices = sorted(by_key.values(), key=lambda x: x["dateISO"], reverse=True)

    # ensure every priority univ has at least a safe board entry (no fake post date if empty)
    have_ids = {n["univId"] for n in prio_notices}
    for cfg in prio:
        if cfg["univId"] in have_ids:
            continue
        prio_notices.append(
            {
                "id": cfg["univId"] + "-liveboard",
                "univId": cfg["univId"],
                "univName": cfg["univName"],
                "title": f"{cfg['univName']} 입학처 전체 공지사항",
                "preview": "실시간 공지 게시판으로 이동합니다 (2026.08.01 이후)",
                "url": cfg["boardUrl"] or cfg["homeUrl"],
                "homeUrl": cfg["homeUrl"],
                "dateISO": "",
                "dateText": "",
                "priority": True,
                "boardOnly": True,
            }
        )

    payload["notices"] = prio_notices + other
    payload["minDate"] = MIN_DATE
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    js = "window.UNIV_BOARD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "univ-board-data.js").write_text(js, encoding="utf-8")
    print("priority notices", len(prio_notices), "total", len(payload["notices"]))


if __name__ == "__main__":
    main()
