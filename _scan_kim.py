import re
from pathlib import Path

raw = Path(r"C:\Users\kth15\AppData\Local\Temp\kim.html").read_bytes()
# try utf-8
text = raw.decode("utf-8", errors="ignore")
print("size", len(text))

needles = [
    "업데이트", "총 ", "NEW", "고려대", "서강대", "badge-new", "is-new",
    "univ-chip", "school-chip", "notice-item", "feed-item", "announcement",
    "pastel", "방문자", "김태훈",
]
for n in needles:
    print(repr(n), text.count(n))

# Find if it's an SPA - look for script src
srcs = re.findall(r'src=["\']([^"\']+)["\']', text)
print("srcs", srcs[:30])
hrefs = re.findall(r'href=["\']([^"\']+)["\']', text)
print("hrefs", hrefs[:40])
print(text[:1500])
