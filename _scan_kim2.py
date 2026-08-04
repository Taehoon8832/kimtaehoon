import re
from pathlib import Path

text = Path(r"C:\Users\kth15\AppData\Local\Temp\kim.html").read_text(encoding="utf-8", errors="ignore")

# Find context around 고려대
idxs = [m.start() for m in re.finditer("고려대", text)]
print("고려대 idxs", len(idxs))
Path(r"C:\Users\kth15\AppData\Local\Temp\kim_korea.txt").write_text(
    "\n\n====\n\n".join(text[max(0, i - 250): i + 250] for i in idxs[:8]),
    encoding="utf-8",
)

# Find class= near university-ish UI
for pat in [
    r'class="[^"]*(?:notice|feed|univ|school|badge|chip|pill|announce|news|update)[^"]*"',
    r'\.([a-zA-Z][a-zA-Z0-9_-]*(?:notice|feed|univ|school|badge|chip|pill|announce)[a-zA-Z0-9_-]*)\s*\{',
]:
    hits = sorted(set(re.findall(pat, text, re.I)))
    print(pat, len(hits))
    for h in hits[:60]:
        print(" ", h)

# Search for "총" near "건"
for m in re.finditer(r"총.{0,12}건", text):
    print("TOTAL", m.group(0), "at", m.start())
    print(text[max(0, m.start()-100): m.end()+100])
