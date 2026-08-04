import re
from pathlib import Path

s2 = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8", errors="ignore")

# any docs/spreadsheets urls including escaped
for pat in [
    r"https://docs\.google\.com/[^\"'\s<>\\]+",
    r"https://[^\"'\s<>\\]*spreadsheets[^\"'\s<>\\]*",
    r"sheetUrl\s*=\s*['\"][^'\"]+",
    r"SHEET[^'\"]{0,40}['\"][^'\"]+",
]:
    hits = re.findall(pat, s2)
    print(pat, "->", len(hits))
    for h in hits[:20]:
        print(" ", h[:250])

# nearby sheet-iframe assignment
print("\n=== sheet-iframe context ===")
for m in re.finditer(r".{0,200}sheet-iframe.{0,300}", s2):
    print(m.group(0).replace("\n", " ")[:500])
    print("---")
