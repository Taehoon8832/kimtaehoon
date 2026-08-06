# -*- coding: utf-8 -*-
"""게시판 JSON/JS 안전 저장 · 재시도 fetch 공통 유틸."""
from __future__ import annotations

import json
import ssl
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CTX = ssl._create_unverified_context()
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_json_payload(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def load_js_payload(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        if "=" not in raw:
            return None
        data = json.loads(raw.split("=", 1)[1].strip().rstrip(";"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def notice_count(payload: dict | None) -> int:
    if not payload:
        return 0
    notices = payload.get("notices")
    return len(notices) if isinstance(notices, list) else 0


def load_previous(json_path: Path, js_path: Path) -> dict | None:
    prev = load_json_payload(json_path)
    if notice_count(prev) > 0:
        return prev
    prev = load_js_payload(js_path)
    if notice_count(prev) > 0:
        return prev
    return prev


def write_board(
    *,
    js_path: Path,
    json_path: Path,
    global_name: str,
    payload: dict,
) -> None:
    json_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    json_path.write_text(text, encoding="utf-8")
    js_path.write_text(
        f"window.{global_name}="
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )


def keep_previous_if_weak(
    *,
    new_notices: list,
    previous: dict | None,
    min_keep_ratio: float = 0.35,
    min_absolute: int = 3,
) -> tuple[list, str]:
    """새 결과가 비었거나 이전 대비 지나치게 적으면 이전 목록 유지."""
    prev_notices = []
    if previous and isinstance(previous.get("notices"), list):
        prev_notices = previous["notices"]
    if not new_notices and prev_notices:
        return prev_notices, "keep_prev_empty"
    if prev_notices and len(new_notices) < max(min_absolute, int(len(prev_notices) * min_keep_ratio)):
        return prev_notices, f"keep_prev_weak:{len(new_notices)}<{len(prev_notices)}"
    return new_notices, "ok"


def fetch_text(
    url: str,
    *,
    headers: dict | None = None,
    timeout: int = 45,
    retries: int = 3,
    backoff: float = 1.2,
) -> str:
    hdrs = {
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    }
    if headers:
        hdrs.update(headers)
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = Request(url, headers=hdrs)
            with urlopen(req, context=CTX, timeout=timeout) as res:
                raw = res.read()
            for enc in ("utf-8", "euc-kr", "cp949"):
                try:
                    return raw.decode(enc)
                except Exception:
                    continue
            return raw.decode("utf-8", "ignore")
        except (HTTPError, URLError, TimeoutError, OSError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(backoff * attempt)
    raise RuntimeError(f"fetch failed after {retries} tries: {url} ({last_err})")
