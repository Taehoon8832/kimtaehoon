import re
from pathlib import Path

s2 = Path(r"C:\Users\kth15\AppData\Local\Temp\daeip_decoded.html").read_text(encoding="utf-8", errors="ignore")

# Find CSS/HTML/JS around home feed patterns from screenshot:
# left accent bar, date, NEW, university chip
patterns = [
    r"getHomeBootstrapData",
    r"getMainSheetData",
    r"getLatestNews",
    r"latest-only",
    r"home-",
    r"feed-",
    r"isNew",
    r"is_new",
    r"newBadge",
    r"new-badge",
    r"대학",
    r"방문자",
    r"건",
    r"row-px",
    r"data-max-rows",
]

for p in patterns:
    print(p, s2.count(p))

# Extract function bodies mentioning bootstrap / main sheet render
for key in ["getHomeBootstrapData", "renderFeed", "renderMain", "buildRow", "createRow", "mainSheet", "homeBootstrap", "latestNews"]:
    idx = s2.find(key)
    if idx >= 0:
        print(f"\n===== context {key} @ {idx} =====")
        print(s2[max(0, idx - 200): idx + 800].replace("\n", "\\n")[:1000])

# Look for class names with accent / stripe / bar
print("\n=== accent-like classes ===")
for c in sorted(set(re.findall(r"\.([a-zA-Z][a-zA-Z0-9_-]*(?:accent|stripe|bar|feed|home|notice|announce|update|meta|count)[a-zA-Z0-9_-]*)", s2))):
    print(c)
