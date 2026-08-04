# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
js_path = ROOT / "univ-board-data.js"
payload = json.loads(js_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))

assert not any("서강" in (n.get("univName") or "") for n in payload.get("notices") or [])

kept = []
seen = set()
for n in payload.get("notices") or []:
    title = re.sub(r"\s+", " ", n.get("title") or "").strip()
    if len(re.findall(r"[가-힣]", title)) < 6:
        print("drop short", title)
        continue
    if re.search(r"편입학\s*간호|한마당|작성일\s*:", title):
        print("drop junk", title)
        continue
    norm = re.sub(r"^\d+\s*", "", title)
    norm = re.sub(r"(작성일|작성자|new).*$", "", norm, flags=re.I).strip()
    key = (n.get("univId"), norm[:48], n.get("dateISO"))
    if key in seen:
        print("drop dup", title)
        continue
    seen.add(key)
    kept.append(n)

payload["notices"] = kept
js_path.write_text(
    "window.UNIV_BOARD_DATA="
    + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    + ";\n",
    encoding="utf-8",
)
(ROOT / "data" / "univ-notices.json").write_text(
    json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("kept", len(kept), "no_sogang=OK")
for n in kept:
    print(n["dateISO"], n["univName"], "|", n["title"][:52])
