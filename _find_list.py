import re
from pathlib import Path

s2 = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8", errors="ignore")

# iframe / sheet urls
urls = sorted(set(re.findall(r"https://[^\"'\s<>]{10,200}", s2)))
print("URLS", len(urls))
for u in urls:
    if any(k in u.lower() for k in ["sheet", "docs.google", "script.google", "drive", "github", "pages"]):
        print(u)

print("\n=== news-list CSS ===")
for m in re.finditer(r"\.(news-list[a-zA-Z0-9_-]*|news-item)[^{]*\{[^}]+\}", s2):
    print(m.group(0)[:500])
    print("---")

print("\n=== pill CSS samples ===")
for m in re.finditer(r"\.[a-zA-Z0-9_-]*pill[a-zA-Z0-9_-]*[^{]*\{[^}]+\}", s2):
    print(m.group(0)[:400])
    print("---")

# look for left border accent patterns typical of the screenshot
print("\n=== border-left / accent bar ===")
for m in re.finditer(r".{0,80}border-left[^;]{0,80};.{0,80}", s2):
    snip = m.group(0).replace("\n", " ")
    if "px" in snip:
        print(snip[:220])
        print("---")
