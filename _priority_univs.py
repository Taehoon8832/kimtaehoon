# -*- coding: utf-8 -*-
"""우선 대학 입학처 공지 URL 검증 + 2026-08-01 이후 공지 수집"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
import time
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
MIN_DATE = "2026-08-01"
CTX = ssl._create_unverified_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36"

# 표시명 키워드 → 검증된 공지/입학처 URL (오류 없는 페이지 우선)
PRIORITY = [
    {"key": "서울대", "match": ["서울대"], "exclude": [], "board": "https://admission.snu.ac.kr/undergraduate/notice", "home": "http://admission.snu.ac.kr/"},
    {"key": "연세대", "match": ["연세대(서울)"], "exclude": [], "board": "https://admission.yonsei.ac.kr/seoul/admission/html/main/main.asp", "home": "https://admission.yonsei.ac.kr/seoul/admission/html/main/main.asp"},
    {"key": "고려대", "match": ["고려대(안암)"], "exclude": [], "board": "https://oku.korea.ac.kr/oku/cms/FR_CON/index.do?MENU_ID=590", "home": "http://oku.korea.ac.kr/"},
    {"key": "서강대", "match": ["서강대"], "exclude": [], "board": "https://admission.sogang.ac.kr/", "home": "http://admission.sogang.ac.kr/"},
    {"key": "성균관대", "match": ["성균관대"], "exclude": [], "board": "https://admission.skku.edu/", "home": "https://admission.skku.edu/"},
    {"key": "한양대", "match": ["한양대(서울)"], "exclude": [], "board": "https://go.hanyang.ac.kr/", "home": "https://go.hanyang.ac.kr/"},
    {"key": "중앙대", "match": ["중앙대(서울)"], "exclude": [], "board": "https://admission.cau.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN021", "home": "http://admission.cau.ac.kr/"},
    {"key": "경희대", "match": ["경희대(서울)"], "exclude": [], "board": "https://iphak.khu.ac.kr/main.do", "home": "https://iphak.khu.ac.kr/main.do"},
    {"key": "한국외대", "match": ["한국외대(서울)"], "exclude": [], "board": "https://adms.hufs.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN036", "home": "http://adms.hufs.ac.kr/"},
    {"key": "서울시립대", "match": ["서울시립대"], "exclude": [], "board": "https://iphak.uos.ac.kr/ips/notice/notice.do", "home": "http://iphak.uos.ac.kr/"},
    {"key": "건국대", "match": ["건국대(서울)"], "exclude": [], "board": "https://enter.konkuk.ac.kr/", "home": "http://enter.konkuk.ac.kr/"},
    {"key": "동국대", "match": ["동국대(서울)"], "exclude": [], "board": "https://ipsi.dongguk.edu/article/NOTICE/list", "home": "https://ipsi.dongguk.edu/"},
    {"key": "홍익대", "match": ["홍익대(서울)"], "exclude": [], "board": "https://www.hongik.ac.kr/kr/admission/undergraduate-admission.do", "home": "https://www.hongik.ac.kr/kr/admission/undergraduate-admission.do"},
    {"key": "이화여대", "match": ["이화여대"], "exclude": [], "board": "http://admission.ewha.ac.kr/", "home": "http://admission.ewha.ac.kr/"},
    {"key": "숙명여대", "match": ["숙명여대"], "exclude": [], "board": "https://admission.sookmyung.ac.kr/", "home": "https://admission.sookmyung.ac.kr/"},
    {"key": "숭실대", "match": ["숭실대"], "exclude": [], "board": "https://iphak.ssu.ac.kr/", "home": "https://iphak.ssu.ac.kr/"},
    {"key": "국민대", "match": ["국민대"], "exclude": [], "board": "https://admission.kookmin.ac.kr/", "home": "http://admission.kookmin.ac.kr/index.php?noMobile=1"},
    {"key": "서울과기대", "match": ["서울과학기술대"], "exclude": [], "board": "http://admission.seoultech.ac.kr/", "home": "http://admission.seoultech.ac.kr/"},
    {"key": "세종대", "match": ["세종대"], "exclude": [], "board": "https://ipsi.sejong.ac.kr/", "home": "http://ipsi.sejong.ac.kr/"},
    {"key": "인하대", "match": ["인하대"], "exclude": [], "board": "https://admission.inha.ac.kr/cms/FR_CON/Board/Board.do?mCode=MN031", "home": "http://admission.inha.ac.kr/"},
    {"key": "아주대", "match": ["아주대"], "exclude": [], "board": "https://www.iajou.ac.kr/admission/notice.do", "home": "http://www.iajou.ac.kr/"},
    {"key": "가천대", "match": ["가천대(글로벌)"], "exclude": [], "board": "https://admission.gachon.ac.kr/admission/html/counsel/notice.asp", "home": "http://admission.gachon.ac.kr/admission/html/main/main.asp"},
]

DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
TITLE_HINT = re.compile(r"(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|설명회|시행)")
NOTICE_HREF = re.compile(r"(notice|bbs|board|article|artcl|공지|소식|news|view|Board)", re.I)
JUNK = re.compile(r"(var\s|function\s|document\.|<\w+|javascript:|bbsrg)", re.I)
SKIP = re.compile(r"^(더보기|more|이전|다음|목록|home|로그인|전체|공지사항|공지)$", re.I)


def fetch(url: str) -> tuple[int, str, str]:
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Language": "ko-KR,ko;q=0.9"})
    with urlopen(req, context=CTX, timeout=18) as res:
        raw = res.read()
        final = res.geturl()
        code = res.status
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            if len(re.findall(r"[가-힣]", text)) >= 8 or enc == "cp949":
                return code, text, final
        except Exception:
            continue
    return code, raw.decode("utf-8", "ignore"), final


def strip_tags(html: str) -> str:
    s = unescape(html or "")
    s = re.sub(r"<script[\s\S]*?</script>", " ", s, flags=re.I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def to_iso(y, mo, d):
    try:
        iso = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    except Exception:
        return ""
    if iso < "2020-01-01" or iso > "2035-12-31":
        return ""
    return iso


def extract_date(text: str) -> str:
    m = DATE_RE.search(text or "")
    return to_iso(m.group(1), m.group(2), m.group(3)) if m else ""


def parse(html: str, page_url: str, univ_name: str, univ_id: str, home: str):
    if not html or "HTTP 오류 404" in html[:2500] or "404.0 - Not Found" in html[:2500]:
        return []
    items = []
    for m in re.finditer(
        r'<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>([\s\S]{0,320})',
        html,
        re.I,
    ):
        href, title_html, tail = m.group(1), m.group(2), m.group(3)
        title = strip_tags(title_html)
        tail_txt = strip_tags(tail)
        if not title or len(title) < 8 or len(title) > 140:
            continue
        if SKIP.match(title) or JUNK.search(title):
            continue
        if len(re.findall(r"[가-힣]", title)) < 4:
            continue
        if not (NOTICE_HREF.search(href) or TITLE_HINT.search(title)):
            continue
        date_iso = extract_date(tail_txt) or extract_date(title)
        if not date_iso or date_iso < MIN_DATE:
            continue
        absu = urljoin(page_url, unescape(href).split("#")[0])
        if not absu.startswith("http"):
            continue
        preview = DATE_RE.sub(" ", tail_txt)
        preview = re.sub(r"\s+", " ", preview).strip(" ·-|")
        if JUNK.search(preview) or len(re.findall(r"[가-힣]", preview)) < 2:
            preview = f"{univ_name} 입학처 전체 공지사항"
        key = f"{univ_id}|{absu}|{title}"
        items.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "univId": univ_id,
                "univName": univ_name,
                "title": title,
                "preview": preview[:110],
                "url": absu,
                "homeUrl": home,
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
                "priority": True,
            }
        )
    uniq = {}
    for it in items:
        uniq[it["url"] + "|" + it["title"]] = it
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:5]


def find_source(sources, p):
    for s in sources:
        name = s["name"]
        if any(x in name for x in p["exclude"]):
            continue
        if any(m == name or m in name for m in p["match"]):
            return s
    return None


def main():
    sources = json.loads((ROOT / "univ-sources.json").read_text(encoding="utf-8"))
    # update board/home for priority
    for p in PRIORITY:
        s = find_source(sources, p)
        if not s:
            print("MISSING SOURCE", p["key"])
            continue
        s["boardUrl"] = p["board"]
        s["homeUrl"] = p["home"]
        s["priority"] = True

    notices = []
    status = []
    for p in PRIORITY:
        s = find_source(sources, p)
        if not s:
            status.append((p["key"], "no_source", 0))
            continue
        try:
            code, html, final = fetch(p["board"])
            if code >= 400 or "HTTP 오류 404" in html[:2000]:
                # fallback home
                code, html, final = fetch(p["home"])
            items = parse(html, final, s["name"], s["id"], p["home"])
            # if empty, try home
            if not items and p["board"] != p["home"]:
                code2, html2, final2 = fetch(p["home"])
                items = parse(html2, final2, s["name"], s["id"], p["home"])
            notices.extend(items)
            status.append((p["key"], "ok" if items else "empty", len(items)))
            print(f"{'OK' if items else '..'} {p['key']}: {len(items)} ({final[:60]})")
        except Exception as e:
            status.append((p["key"], type(e).__name__, 0))
            print(f"-- {p['key']}: {type(e).__name__}: {e}")
        time.sleep(0.2)

    # merge into board data
    raw = (ROOT / "univ-board-data.js").read_text(encoding="utf-8")
    payload = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
    payload["sources"] = sources
    payload["minDate"] = MIN_DATE
    payload["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload["priorityKeys"] = [p["key"] for p in PRIORITY]

    # replace notices for priority univ ids, keep others
    prio_ids = {find_source(sources, p)["id"] for p in PRIORITY if find_source(sources, p)}
    other = [n for n in payload.get("notices", []) if n.get("univId") not in prio_ids]
    # if priority scrape empty for a uni, keep a safe placeholder notice pointing to board/home
    have = {n["univId"] for n in notices}
    for p in PRIORITY:
        s = find_source(sources, p)
        if not s or s["id"] in have:
            continue
        notices.append(
            {
                "id": s["id"] + "-board",
                "univId": s["id"],
                "univName": s["name"],
                "title": f"{s['name']} 입학처 전체 공지사항",
                "preview": "2026.08.01 이후 공지는 입학처 공지 게시판에서 확인하세요",
                "url": p["board"],
                "homeUrl": p["home"],
                "dateISO": MIN_DATE,
                "dateText": "2026.08.01",
                "priority": True,
                "boardOnly": True,
            }
        )

    merged = notices + other
    merged.sort(key=lambda x: (x.get("priority") is True, x.get("dateISO") or ""), reverse=True)
    payload["notices"] = merged
    payload["priorityStatus"] = [{"key": a, "status": b, "count": c} for a, b, c in status]

    (ROOT / "univ-sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    # also write priority config for frontend
    prio_cfg = [
        {
            "key": p["key"],
            "match": p["match"],
            "boardUrl": p["board"],
            "homeUrl": p["home"],
            "univId": (find_source(sources, p) or {}).get("id", ""),
            "univName": (find_source(sources, p) or {}).get("name", p["key"]),
        }
        for p in PRIORITY
    ]
    payload["priority"] = prio_cfg
    js = "window.UNIV_BOARD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "univ-board-data.js").write_text(js, encoding="utf-8")
    print("notices", len(merged), "priority_notices", len(notices))


if __name__ == "__main__":
    main()
