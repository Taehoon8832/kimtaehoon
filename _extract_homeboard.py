import re
from pathlib import Path

raw = Path(r"C:\Users\kth15\AppData\Local\Temp\homeboard.html").read_text(encoding="utf-8", errors="ignore")

def unescape(s: str) -> str:
    s = re.sub(r"\\\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = re.sub(r"\\x([0-9a-fA-F]{2})", lambda m: chr(int(m.group(1), 16)), s)
    s = s.replace("\\\\n", "\n").replace("\\n", "\n")
    s = s.replace('\\"', '"').replace("\\'", "'")
    def uni(m):
        try:
            return chr(int(m.group(1), 16))
        except Exception:
            return m.group(0)
    s = re.sub(r"\\u([0-9a-fA-F]{4})", uni, s)
    return s

s2 = unescape(raw)
out = Path(r"C:\Users\kth15\AppData\Local\Temp\homeboard_decoded.html")
out.write_text(s2, encoding="utf-8")
print("len", len(s2))

for n in ["NEW", "업데이트", "총 ", "고려대", "서강대", "badge", "univ", "school", "pill", "chip", "feed", "notice", "item", "row", "padding"]:
    print(f"{n}: {s2.count(n)}")

classes = sorted(set(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]{1,60})", s2)))
print("classes", len(classes))
for c in classes:
    if re.search(r"(new|feed|notice|univ|school|chip|badge|item|row|list|card|pill|tag|event|meet)", c, re.I):
        print(c)

# write style section extract
styles = re.findall(r"<style[^>]*>([\s\S]*?)</style>", s2, re.I)
Path(r"C:\Users\kth15\AppData\Local\Temp\homeboard_styles.css").write_text("\n\n".join(styles), encoding="utf-8")
print("styles blocks", len(styles), "chars", sum(len(x) for x in styles))
