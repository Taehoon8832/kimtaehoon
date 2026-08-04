import re
from pathlib import Path

# Search both decoded appscript and kim.html
files = {
    "daeip": Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8", errors="ignore"),
    "kim": Path(r"C:\Users\kth15\AppData\Local\Temp\kim.html").read_text(encoding="utf-8", errors="ignore"),
    "board": Path(r"C:\Users\kth15\OneDrive\문서\GitHub\kimtaehoon\board-extracted.html").read_text(encoding="utf-8", errors="ignore"),
    "insight": Path(r"C:\Users\kth15\AppData\Local\Temp\insight_decoded.html").read_text(encoding="utf-8", errors="ignore"),
    "homeboard": Path(r"C:\Users\kth15\AppData\Local\Temp\homeboard_decoded.html").read_text(encoding="utf-8", errors="ignore"),
}

needles = [
    "오후", "업데이트", "badge-new", "is-new", "new-badge", "NEW",
    "univ-logo", "school-logo", "uni-chip", "univ-chip", "school-badge",
    "notice-list", "delta-list", "info-list", "post-list",
    "border-left", "accent-bar", "row-accent", "left-bar",
    "총 ", "건", "logo-img", "favicon",
]

out_lines = []
for name, text in files.items():
    out_lines.append(f"===== {name} len={len(text)} =====")
    for n in needles:
        c = text.count(n)
        if c:
            out_lines.append(f"  {n!r}: {c}")

# In kim, find elements that look like the screenshot UI - search for 'NEW' as badge text in JS templates
kim = files["kim"]
for m in re.finditer(r"""['"]NEW['"]""", kim):
    out_lines.append("NEW lit: " + kim[max(0, m.start()-120): m.end()+120].replace("\n", " ")[:240])

# Look for template strings with date + badge pattern
for m in re.finditer(r"isNew|is_new|showNew|hasNew|newFlag|new_flag", kim):
    out_lines.append("newFlag: " + kim[max(0, m.start()-80): m.end()+120].replace("\n", " ")[:240])

# Search daeip for img tags / logo
for name in ["daeip", "kim"]:
    text = files[name]
    imgs = re.findall(r"<img[^>]{0,200}>", text)
    out_lines.append(f"{name} img tags: {len(imgs)}")
    for im in imgs[:15]:
        out_lines.append("  " + im[:200])

Path(r"C:\Users\kth15\AppData\Local\Temp\find_ui2.txt").write_text("\n".join(out_lines), encoding="utf-8")
print("wrote", len(out_lines))
