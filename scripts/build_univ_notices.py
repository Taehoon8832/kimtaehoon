# -*- coding: utf-8 -*-
"""전체 대학 입학처 공지 수집 (2026-08-01 이후) → univ-board-data.js"""
from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
MIN_DATE = "2026-08-01"
MAX_PER = 6
USE_JINA = (os.environ.get("USE_JINA") or "1").strip() not in ("0", "false", "False")
CTX = ssl._create_unverified_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
BAD_TITLE = re.compile(
    r"(채용\s*공고|직원\s*채용|근로장학생|학자금대출|문의\s*\(\d|공지사항\s*더보기|"
    r"^대학\s*입학\s*문의|분실물|OMR|문서등록|예비소집\s*/)",
    re.I,
)

DATE_RE = re.compile(r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})")
TITLE_HINT = re.compile(
    r"(공지|안내|모집|요강|발표|일정|변경|합격|전형|수시|정시|면접|설명회|시행|모의|상담|접수|결과)"
)
NOTICE_HREF = re.compile(
    r"(notice|bbs|board|article|artcl|공지|소식|news|view|Board|ipsi|admission|ntt|brd)",
    re.I,
)
JUNK = re.compile(
    r"(var\s|function\s|document\.|<\w+|javascript:|bbsrg|사이트맵|로그인|개인정보|이용약관|웹접근성)",
    re.I,
)
SKIP = re.compile(
    r"^(더보기|more|이전|다음|목록|home|로그인|전체|공지사항|공지|뉴스|새글|N|NEW)$",
    re.I,
)
BROKEN = re.compile(r"/admission/html/notice/notice\.asp$|error404|404\.html", re.I)
MD_LINK = re.compile(
    r"\[([^\]]{6,180})\]\((https?://[^)\s]+)\)([\s\S]{0,160}?)"
    r"(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})"
)
COMMON_PATHS = (
    "/notice",
    "/bbs/notice",
    "/board/notice",
    "/admission/notice",
    "/ipsi/notice",
    "/enter/notice",
    "/html/notice/notice.asp",
    "/cms/FR_CON/Board/Board.do",
)


def load_sources():
    js = ROOT / "univ-board-data.js"
    if js.exists():
        raw = js.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";")
        try:
            return json.loads(raw).get("sources") or []
        except Exception:
            pass
    return json.loads((ROOT / "univ-sources.json").read_text(encoding="utf-8"))


def fetch(url: str, timeout: int = 16):
    req = Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
    )
    with urlopen(req, context=CTX, timeout=timeout) as res:
        raw = res.read()
        final = res.geturl()
        code = getattr(res, "status", 200) or 200
    for enc in ("utf-8", "euc-kr", "cp949"):
        try:
            text = raw.decode(enc)
            if len(re.findall(r"[가-힣]", text)) >= 6 or enc == "cp949":
                return code, text, final
        except Exception:
            continue
    return code, raw.decode("utf-8", "ignore"), final


def fetch_jina(url: str) -> str:
    code, text, _ = fetch("https://r.jina.ai/" + url, timeout=40)
    if code >= 400 or len(text) < 200:
        return ""
    return text


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


def clean_title(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "")).strip()
    t = re.sub(r"^(새글|N|NEW|공지)\s*", "", t, flags=re.I)
    t = DATE_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" ·-|")
    return t


def is_404(html: str) -> bool:
    head = (html or "")[:2800]
    return ("HTTP 오류 404" in head) or ("404.0 - Not Found" in head) or ("error404" in head.lower())


def make_item(src: dict, title: str, preview: str, absu: str, date_iso: str):
    title = clean_title(title)
    if not title or len(title) < 8 or len(title) > 140:
        return None
    if SKIP.match(title) or JUNK.search(title) or BAD_TITLE.search(title):
        return None
    if len(re.findall(r"[가-힣]", title)) < 4:
        return None
    if not date_iso or date_iso < MIN_DATE:
        return None
    if date_iso > "2026-08-31" and not TITLE_HINT.search(title):
        return None
    if not absu.startswith("http") or BROKEN.search(absu):
        return None
    preview = DATE_RE.sub(" ", preview or "")
    preview = re.sub(r"\s+", " ", preview).strip(" ·-|")
    if JUNK.search(preview) or len(re.findall(r"[가-힣]", preview)) < 2:
        preview = f"{src['name']} 입학 공지사항 미리보기"
    key = f"{src['id']}|{absu}|{title}"
    return {
        "id": hashlib.sha1(key.encode()).hexdigest()[:20],
        "univId": src["id"],
        "univName": src["name"],
        "title": title,
        "preview": preview[:120],
        "url": absu,
        "homeUrl": src.get("homeUrl") or "",
        "dateISO": date_iso,
        "dateText": date_iso.replace("-", "."),
    }


def parse_html(html: str, page_url: str, src: dict):
    if not html or is_404(html):
        return []
    items = []
    for m in re.finditer(
        r'<a[^>]+href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>([\s\S]{0,360})',
        html,
        re.I,
    ):
        href = unescape(m.group(1)).strip()
        title = strip_tags(m.group(2))
        tail = strip_tags(m.group(3))
        if not (NOTICE_HREF.search(href) or TITLE_HINT.search(title)):
            continue
        date_iso = extract_date(tail) or extract_date(title)
        # nearby window before link (list layouts put date left)
        if not date_iso:
            continue
        absu = urljoin(page_url, href.split("#")[0])
        it = make_item(src, title, tail, absu, date_iso)
        if it:
            items.append(it)
    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]


def parse_markdown(md: str, src: dict):
    items = []
    for m in MD_LINK.finditer(md or ""):
        title = strip_tags(m.group(1))
        url = m.group(2).split("#")[0]
        tail = strip_tags(m.group(3))
        date_iso = to_iso(m.group(4), m.group(5), m.group(6))
        if not (NOTICE_HREF.search(url) or TITLE_HINT.search(title)):
            continue
        it = make_item(src, title, tail, url, date_iso)
        if it:
            items.append(it)
    # fallback: title lines with nearby dates (no markdown link)
    for m in re.finditer(
        r"(?:^|\n)\s*(?:[-*•]\s*)?(.{8,140}?)\s+(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})",
        md or "",
    ):
        title = strip_tags(m.group(1))
        date_iso = to_iso(m.group(2), m.group(3), m.group(4))
        if not TITLE_HINT.search(title):
            continue
        home = (src.get("boardUrl") or src.get("homeUrl") or "").strip()
        it = make_item(src, title, f"{src['name']} 입학 공지사항 미리보기", home, date_iso)
        if it:
            items.append(it)
    uniq = {f"{it['url']}|{it['title']}": it for it in items}
    return sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]


def candidate_urls(src: dict):
    urls = []
    for u in ((src.get("boardUrl") or "").strip(), (src.get("homeUrl") or "").strip()):
        if u and u not in urls and not BROKEN.search(u):
            urls.append(u)
    home = (src.get("homeUrl") or "").strip()
    if home and not BROKEN.search(home):
        try:
            p = urlparse(home)
            base = f"{p.scheme}://{p.netloc}"
            for path in COMMON_PATHS:
                u = urljoin(base + "/", path.lstrip("/"))
                if u not in urls and not BROKEN.search(u):
                    urls.append(u)
        except Exception:
            pass
    return urls[:5]


def scrape_one(src, use_jina=False):
    urls = candidate_urls(src)
    if not urls:
        return [], "no_url"
    all_items = []
    err = ""
    for u in urls:
        try:
            code, html, final = fetch(u)
            if code >= 400 or is_404(html):
                err = f"http_{code}"
                continue
            items = parse_html(html, final, src)
            all_items.extend(items)
            if items:
                break
        except Exception as e:
            err = type(e).__name__
    if not all_items and use_jina:
        for u in urls[:2]:
            try:
                md = fetch_jina(u)
                items = parse_markdown(md, src)
                all_items.extend(items)
                if items:
                    break
                time.sleep(0.35)
            except Exception as e:
                err = "jina_" + type(e).__name__
    uniq = {f"{it['url']}|{it['title']}": it for it in all_items}
    items = sorted(uniq.values(), key=lambda x: x["dateISO"], reverse=True)[:MAX_PER]
    return items, ("ok" if items else (err or "empty"))


def main():
    sources = load_sources()
    groups = {}
    for s in sources:
        key = ((s.get("homeUrl") or "") + "|" + (s.get("boardUrl") or "")).strip("|")
        if not key:
            key = s["id"]
        groups.setdefault(key, []).append(s)

    print(f"sources={len(sources)} groups={len(groups)}")
    results = {}
    ok = empty = fail = 0

    # pass 1: fast direct HTML
    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(scrape_one, g[0], False): g for g in groups.values()}
        for fut in as_completed(futs):
            group = futs[fut]
            items, status = fut.result()
            name = group[0]["name"]
            if status == "ok":
                ok += 1
                for src in group:
                    for it in items:
                        copy = dict(it)
                        copy["univId"] = src["id"]
                        copy["univName"] = src["name"]
                        copy["homeUrl"] = src.get("homeUrl") or copy.get("homeUrl") or ""
                        k = f"{copy['univId']}|{copy['url']}|{copy['title']}"
                        copy["id"] = hashlib.sha1(k.encode()).hexdigest()[:20]
                        results[k] = copy
                print(f"OK  {name}: {len(items)}")
            elif status in ("empty", "no_url"):
                empty += 1
            else:
                fail += 1

    # pass 2: jina for empty groups that have boardUrl (rate-limited)
    need_jina = []
    covered_keys = set()
    for k, it in results.items():
        covered_keys.add(((it.get("homeUrl") or "") + "|" + "").strip())
    have_univ = {it["univId"] for it in results.values()}
    for g in groups.values():
        if any(s["id"] in have_univ for s in g):
            continue
        if (g[0].get("boardUrl") or "").strip() or (g[0].get("priority")):
            need_jina.append(g)

    if USE_JINA:
        print(f"jina_pass candidates={len(need_jina)}")
        for g in need_jina:
            items, status = scrape_one(g[0], True)
            name = g[0]["name"]
            if status == "ok":
                ok += 1
                empty = max(0, empty - 1)
                for src in g:
                    for it in items:
                        copy = dict(it)
                        copy["univId"] = src["id"]
                        copy["univName"] = src["name"]
                        copy["homeUrl"] = src.get("homeUrl") or copy.get("homeUrl") or ""
                        k = f"{copy['univId']}|{copy['url']}|{copy['title']}"
                        copy["id"] = hashlib.sha1(k.encode()).hexdigest()[:20]
                        results[k] = copy
                print(f"JINA {name}: {len(items)}")
            time.sleep(0.55)
    else:
        print("jina_pass skipped (USE_JINA=0)")

    notices = sorted(results.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)
    priority = []
    js_path = ROOT / "univ-board-data.js"
    json_path = ROOT / "data" / "univ-notices.json"
    if js_path.exists():
        try:
            old = json.loads(js_path.read_text(encoding="utf-8").split("=", 1)[1].strip().rstrip(";"))
            priority = old.get("priority") or []
            for n in old.get("notices") or []:
                if not n.get("dateISO") or n["dateISO"] < MIN_DATE:
                    continue
                if not n.get("title") or not n.get("url"):
                    continue
                if BAD_TITLE.search(n.get("title") or ""):
                    continue
                k = f"{n.get('univId')}|{n.get('url')}|{n.get('title')}"
                results.setdefault(k, n)
            notices = sorted(results.values(), key=lambda x: (x["dateISO"], x["title"]), reverse=True)
        except Exception:
            priority = []

    payload = {
        "minDate": MIN_DATE,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": sources,
        "notices": notices,
        "priority": priority,
    }
    (ROOT / "univ-sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    js = "window.UNIV_BOARD_DATA=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
    js_path.write_text(js, encoding="utf-8")
    univs = len({n["univId"] for n in notices})
    print(f"done ok={ok} empty={empty} fail={fail} notices={len(notices)} univs={univs}")
    print(f"wrote {js_path.name} and {json_path.as_posix()}")


if __name__ == "__main__":
    main()
