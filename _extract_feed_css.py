import re
from pathlib import Path

text = Path(r"C:\Users\kth15\AppData\Local\Temp\kim.html").read_text(encoding="utf-8", errors="ignore")

# Extract CSS rules for sheets-tl / susi-sched / related
keys = [
    "sheets-tl", "susi-sched", "sheets-chip", "sheets-agg", "tl-feed",
    "tl-item", "tl-row", "is-new", "badge-new", "new-badge", "univ",
]
rules = []
for m in re.finditer(r"([^{}]+)\{([^{}]+)\}", text):
    sel, body = m.group(1), m.group(2)
    if any(k in sel for k in keys):
        rules.append(f"{sel.strip()} {{{body.strip()}}}")

out = Path(r"C:\Users\kth15\AppData\Local\Temp\feed_rules.css")
out.write_text("\n\n".join(rules), encoding="utf-8")
print("rules", len(rules), "->", out)

# Also dump HTML snippets for sheets-tl-feed
for key in ["sheets-tl-feed", "susi-sched-feed", "sheets-chip", "총 "]:
    i = text.find(key)
    print(key, "at", i)
    if i >= 0:
        Path(rf"C:\Users\kth15\AppData\Local\Temp\snip_{key.replace(' ','_')}.txt").write_text(
            text[max(0, i - 500): i + 2000], encoding="utf-8"
        )

# Decode insight apps script
raw = Path(r"C:\Users\kth15\AppData\Local\Temp\insight.html").read_text(encoding="utf-8", errors="ignore")
def unescape(s: str) -> str:
    s = re.sub(r"\\\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("\\\\n", "\n").replace("\\n", "\n")
    s = s.replace('\\"', '"')
    def uni(m):
        try: return chr(int(m.group(1), 16))
        except Exception: return m.group(0)
    return re.sub(r"\\u([0-9a-fA-F]{4})", uni, s)
s2 = unescape(raw)
Path(r"C:\Users\kth15\AppData\Local\Temp\insight_decoded.html").write_text(s2, encoding="utf-8")
print("insight len", len(s2))
for n in ["NEW", "업데이트", "총 ", "고려대", "badge", "univ", "feed", "notice", "chip", "pill"]:
    print(n, s2.count(n))
