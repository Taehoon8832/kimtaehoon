import re
from pathlib import Path

daeip = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8")
kim = Path(r"C:\Users\kth15\AppData\Local\Temp\kim.html").read_text(encoding="utf-8")

lines = []

# daeip 오후 context
for m in re.finditer("오후", daeip):
    lines.append("DAEIP 오후:\n" + daeip[max(0, m.start()-300): m.end()+300])

for m in re.finditer("업데이트", daeip):
    lines.append("DAEIP 업데이트:\n" + daeip[max(0, m.start()-300): m.end()+300])

for m in re.finditer("업데이트", kim):
    lines.append("KIM 업데이트:\n" + kim[max(0, m.start()-300): m.end()+300])

for m in re.finditer(r"총\s*\$\{|총\s*'|총\s*\"|총 </|총 <span|건</", kim):
    lines.append("KIM 총/건:\n" + kim[max(0, m.start()-200): m.end()+200])

# Search for class names that include tl-item, feed-item style row builders
for pat in [r"className\s*=\s*[`'\"][^`'\"]{0,80}", r"class=\"[^\"]{0,60}\""]:
    pass

# Find any '건' preceded by number formatting
for m in re.finditer(r".{0,40}건.{0,40}", kim):
    snip = m.group(0)
    if any(x in snip for x in ["총", "count", "Count", "length", "건)"]):
        lines.append("KIM 건 snip: " + snip.replace("\n", " "))

# Look for university chip rendering with color
for m in re.finditer(r".{0,60}(univColor|schoolColor|chipColor|pastel|logoUrl|univLogo).{0,60}", kim, re.I):
    lines.append("color/logo: " + m.group(0).replace("\n", " "))

# In daeip, search for render functions that might build fancy rows
for m in re.finditer(r"function\s+(\w+)\s*\(", daeip):
    name = m.group(1)
    if any(k in name.lower() for k in ["render", "build", "paint", "draw", "row", "card", "list", "feed", "news", "main", "home"]):
        lines.append(f"fn {name} @ {m.start()}")

Path(r"C:\Users\kth15\AppData\Local\Temp\find_ui3.txt").write_text("\n\n".join(lines), encoding="utf-8")
print("lines", len(lines))
