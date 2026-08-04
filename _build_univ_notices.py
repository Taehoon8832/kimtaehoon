# -*- coding: utf-8 -*-
"""로컬 편의 래퍼 → scripts/build_univ_notices.py"""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent / "scripts" / "build_univ_notices.py"), run_name="__main__")
