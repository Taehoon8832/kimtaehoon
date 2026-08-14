# -*- coding: utf-8 -*-
"""서강·성균·인하·경기대 입학처 공지 URL 교정 + 즉시 재수집."""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_univ_notices import (  # noqa: E402
    MIN_DATE,
    SPECIAL_UNIV,
    load_sources,
    scrape_one,
)

TARGET_IDS = ("u016", "u025", "u093", "u005", "u049")


def main():
    sources = load_sources()
    by_id = {s["id"]: s for s in sources}
    # persist corrected board/home into sources list
    for sid, cfg in SPECIAL_UNIV.items():
        if sid not in by_id:
            continue
        by_id[sid]["homeUrl"] = cfg["homeUrl"]
        by_id[sid]["boardUrl"] = cfg["boardUrl"]
        by_id[sid]["priority"] = True

    fresh = []
    for sid in TARGET_IDS:
        src = by_id.get(sid)
        if not src:
            print("missing", sid)
            continue
        items, status = scrape_one(src, use_jina=False)
        print(f"{src['name']}: {status} {len(items)}")
        for it in items:
            print(" -", it["dateISO"], it["title"][:56])
            print("   ", it["url"][:110])
        fresh.extend(items)

    js_path = ROOT / "univ-board-data.js"
    json_path = ROOT / "data" / "univ-notices.json"
    payload = {}
    if js_path.exists():
        payload = json.loads(js_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))

    payload["sources"] = list(by_id.values()) if by_id else sources
    # sync univ-sources.json order from file if present
    src_path = ROOT / "univ-sources.json"
    if src_path.exists():
        ordered = json.loads(src_path.read_text(encoding="utf-8"))
        for s in ordered:
            cfg = SPECIAL_UNIV.get(s.get("id") or "")
            if cfg:
                s["homeUrl"] = cfg["homeUrl"]
                s["boardUrl"] = cfg["boardUrl"]
                s["priority"] = True
        payload["sources"] = ordered
        src_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    old_notices = [n for n in (payload.get("notices") or []) if n.get("univId") not in TARGET_IDS]
    # drop stale boardOnly placeholders for targets
    merged = old_notices + fresh
    merged.sort(key=lambda x: (x.get("dateISO") or "", x.get("title") or ""), reverse=True)
    payload["notices"] = merged
    payload["minDate"] = MIN_DATE
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload["checkedAt"] = payload["updatedAt"]
    payload["today"] = (datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d"))

    # priority board urls
    prio = payload.get("priority") or []
    board_map = {
        "서강대": SPECIAL_UNIV["u016"],
        "성균관대": SPECIAL_UNIV["u025"],
        "인하대": SPECIAL_UNIV["u093"],
        "경기대": SPECIAL_UNIV["u005"],
    }
    for p in prio:
        cfg = board_map.get(p.get("key") or "")
        if not cfg:
            continue
        p["boardUrl"] = cfg["boardUrl"]
        p["homeUrl"] = cfg["homeUrl"]
    # ensure 경기대 priority entry exists
    if not any(p.get("key") == "경기대" for p in prio):
        prio.append(
            {
                "key": "경기대",
                "match": ["경기대(서울)", "경기대(수원)"],
                "boardUrl": SPECIAL_UNIV["u005"]["boardUrl"],
                "homeUrl": SPECIAL_UNIV["u005"]["homeUrl"],
                "univId": "u005",
                "univName": "경기대(서울)",
            }
        )
    payload["priority"] = prio

    js_path.write_text(
        "window.UNIV_BOARD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", len(fresh), "fresh notices; total", len(merged))


if __name__ == "__main__":
    main()
