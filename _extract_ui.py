import re
from pathlib import Path

raw = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip.html").read_text(encoding="utf-8", errors="ignore")

def unescape(s: str) -> str:
    s = re.sub(r"\\\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("\\\\n", "\n").replace("\\n", "\n")
    s = s.replace('\\"', '"').replace("\\'", "'")
    s = s.replace("\\\\u", "\\u")
    def uni(m):
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return m.group(0)
    s = re.sub(r"\\u([0-9a-fA-F]{4})", uni, s)
    return s

s2 = unescape(raw)
out = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html")
out.write_text(s2, encoding="utf-8")
print("wrote", out, "len", len(s2))

needles = [
    "고려대", "서강대", "NEW", "업데이트", "총 ", "badge-new",
    "univ", "school", "feed-item", "notice-item", "timeline",
    "info-row", "post-row", "chip", "pill", "logo",
]
for n in needles:
    print(f"{n!r}: {s2.count(n)}")

# classes that look like list rows
classes = sorted(set(re.findall(
    r"\.([a-zA-Z][a-zA-Z0-9_-]{2,80})",
    s2,
)))
interesting = [c for c in classes if re.search(
    r"(new|feed|notice|univ|school|chip|badge|timeline|announ|post|item|row|list|card|pill|tag|meta)",
    c, re.I,
)]
print("interesting classes:", len(interesting))
for c in interesting:
    print(c)

# snippets around NEW badge style
print("\n=== NEW snippets ===")
for m in re.finditer(r".{0,120}NEW.{0,120}", s2):
    snip = m.group(0).replace("\n", " ")
    print(snip[:240])
    print("---")
