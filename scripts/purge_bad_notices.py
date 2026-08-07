# -*- coding: utf-8 -*-
"""부정확·비공지성 항목 제거."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def admission_min_date() -> str:
    from datetime import datetime, timedelta, timezone

    today = (datetime.now(timezone.utc) + timedelta(hours=9)).date()
    if today.month >= 8:
        return f"{today.year}-08-01"
    return f"{today.year - 1}-08-01"


MIN = admission_min_date()
js_path = ROOT / "univ-board-data.js"
payload = json.loads(js_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))

WEAK_URL = re.compile(
    r"(javascript:|void\(0\)|/(main|index|intro)(\.(asp|do|php|html?))?/?$)",
    re.I,
)
HAS_ID = re.compile(
    r"[?&](id|no|seq|idx|bbsidx|ntt|article|artcl|brdIdx|dataSid|uid|num|p_board_idx)=",
    re.I,
)
BAD = re.compile(
    r"(화살표|채용|근로장학생|학자금대출|문의\s*\(\d|공지사항\s*더보기|"
    r"^대학\s*입학\s*문의|분실물|OMR|문서등록|부탁드립니다|문의드립니다|"
    r"\[답변완료\]|허리\s*관련|청소년상담|시간제\s*시간제|^\)\s*|작성일\s*$)",
    re.I,
)
DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")


def title_date(title: str) -> str:
    m = DATE_RE.search(title or "")
    if not m:
        return ""
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"


kept = []
for n in payload.get("notices") or []:
    title = (n.get("title") or "").strip()
    url = (n.get("url") or "").strip()
    date = title_date(title) or (n.get("dateISO") or "")[:10]
    drop = ""
    if not title or not url:
        drop = "empty"
    elif BAD.search(title):
        drop = "bad_title"
    elif not date or date < MIN:
        drop = "old_date"
    elif WEAK_URL.search(url) and not HAS_ID.search(url):
        drop = "weak_url"
    if drop:
        print("drop", drop, n.get("univName"), title[:48])
        continue
    item = dict(n)
    item["dateISO"] = date
    item["dateText"] = date.replace("-", ".")
    t2 = re.sub(r"\s+", " ", DATE_RE.sub(" ", title)).strip(" ·-|")
    if len(t2) >= 8:
        item["title"] = t2
    # 미리보기 정리
    prev = item.get("preview") or ""
    if re.search(r"화살표|이전페이지|다음페이지|</", prev):
        item["preview"] = f"{item['univName']} 입학 공지사항 미리보기"
    kept.append(item)

# 중복 제목 축약 (같은 대학·같은 제목)
uniq = {}
for n in kept:
    key = f"{n['univId']}|{re.sub(r'^\\d+\\s*', '', n['title'])}|{n['dateISO']}"
    uniq[key] = n
kept = sorted(uniq.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)
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
print("kept", len(kept))
for n in kept:
    print(n["dateISO"], n["univName"], "|", n["title"][:52])
