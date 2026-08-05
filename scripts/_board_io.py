# -*- coding: utf-8 -*-
"""게시판 JSON/JS 입출력 · 실패 시 이전 데이터 유지."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def load_js_payload(js_path: Path, global_name: str) -> dict[str, Any] | None:
    if not js_path.exists():
        return None
    text = js_path.read_text(encoding="utf-8")
    marker = f"window.{global_name}="
    if marker not in text:
        return None
    raw = text.split(marker, 1)[1].strip().rstrip(";").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def load_json_payload(json_path: Path) -> dict[str, Any] | None:
    if not json_path.exists():
        return None
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def load_board(root: Path, js_name: str, global_name: str, json_rel: str) -> dict[str, Any] | None:
    js_path = root / js_name
    json_path = root / json_rel
    return load_js_payload(js_path, global_name) or load_json_payload(json_path)


def write_board(root: Path, js_name: str, global_name: str, json_rel: str, payload: dict[str, Any]) -> None:
    js_path = root / js_name
    json_path = root / json_rel
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        f"window.{global_name}="
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )


def notice_count(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    notices = payload.get("notices")
    return len(notices) if isinstance(notices, list) else 0


def looks_blocked(html: str) -> bool:
    text = html or ""
    if not text:
        return True
    if "Security Check" in text and len(text) < 8000:
        return True
    if re.search(r"cf-browser-verification|just a moment|access denied|captcha", text, re.I):
        if len(text) < 20000 and "__NUXT_DATA__" not in text:
            return True
    return False
