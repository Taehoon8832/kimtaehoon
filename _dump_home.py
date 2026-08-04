import re
from pathlib import Path

s2 = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8", errors="ignore")
out = Path(r"C:\Users\kth15\AppData\Local\Temp\home_bits.txt")

chunks = []
for m in re.finditer(r".{0,40}home-[a-zA-Z0-9_-]+.{0,40}", s2):
    chunks.append(m.group(0).replace("\n", " "))

# Also find Korean "업데이트" via unicode codepoints in source
for needle in ["업데이트", "총 ", "NEW", "new", "대학공지", "공지사항"]:
    chunks.append(f"COUNT {needle}={s2.count(needle)}")

# Extract all CSS class definitions containing 'home'
for m in re.finditer(r"\.(home-[a-zA-Z0-9_-]+)[^{]*\{[^}]*\}", s2):
    chunks.append(m.group(0))

# Look for styles with padding that might be list rows - high padding values
for m in re.finditer(r"\.[a-zA-Z0-9_-]+\s*\{[^}]{0,300}padding:\s*(1[2-9]|[2-9]\d)px[^}]{0,300}\}", s2):
    block = m.group(0)
    if any(k in block for k in ["item", "row", "card", "list", "feed", "notice", "delta", "main"]):
        chunks.append(block[:400])

out.write_text("\n---\n".join(chunks), encoding="utf-8")
print("wrote", out, "chunks", len(chunks))
