# -*- coding: utf-8 -*-
"""잡코리아 홈 '인기 JOB' → jobkorea-board-data.js / data/jobkorea-notices.json

출처: https://www.jobkorea.co.kr/ 인기 JOB 섹션
API: jk-bff-display-api.jobkorea.co.kr/v1/home/jobs/curated?sc=729
     (type.code == POPULAR)

정확성 우선:
- 기업명·제목·등록일·마감일·URL은 API 원문만 사용
- 이웃 보간·추측 날짜 사용 금지
- 목록은 인기 JOB 집합만 유지하고 firstPostedAt 최신순 정렬
"""
from __future__ import annotations

import hashlib
import json
import re
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
HOME_URL = "https://www.jobkorea.co.kr/"
API_URL = "https://jk-bff-display-api.jobkorea.co.kr/v1/home/jobs/curated?sc=729"
CTX = ssl._create_unverified_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CAREER_LABEL = {
    "NEWBIE": "신입",
    "EXPERIENCED": "경력",
    "INTERN": "인턴",
    "IRRELEVANT": "경력무관",
}
EMP_LABEL = {
    "PERMANENT": "정규직",
    "CONTRACT": "계약직",
    "INTERN": "인턴",
    "FREELANCER": "프리랜서",
    "DISPATCH": "파견직",
    "PART_TIME": "파트타임",
}


def seoul_today() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=9)).strftime("%Y-%m-%d")


def date_only(val) -> str:
    s = str(val or "").strip()
    m = re.match(r"(20\d{2}-\d{2}-\d{2})", s)
    return m.group(1) if m else ""


def dday_label(deadline_iso: str, today: str, always_hire: bool) -> str:
    if always_hire:
        return "상시채용"
    if not deadline_iso or not today:
        return ""
    # 잡코리아 상시/무기한 관례값
    if deadline_iso >= "2069-01-01":
        return "상시채용"
    try:
        d0 = datetime.strptime(today, "%Y-%m-%d").date()
        d1 = datetime.strptime(deadline_iso, "%Y-%m-%d").date()
    except ValueError:
        return ""
    diff = (d1 - d0).days
    if diff > 0:
        return f"D-{diff}"
    if diff == 0:
        return "D-Day"
    return f"마감+{abs(diff)}"


def career_text(job: dict) -> str:
    types = job.get("careerTypes") or job.get("careerType") or []
    labels = []
    for t in types:
        lab = CAREER_LABEL.get(str(t), "")
        if lab and lab not in labels:
            labels.append(lab)
    year = job.get("careerYear")
    try:
        year_n = int(year) if year is not None else 0
    except (TypeError, ValueError):
        year_n = 0
    if year_n > 0 and "경력" in labels:
        return f"경력 {year_n}년↑" if labels == ["경력"] else ("·".join(labels) + f" {year_n}년↑")
    if labels:
        return "·".join(labels)
    return ""


def employment_text(job: dict) -> str:
    types = job.get("employmentTypes") or []
    if not types and job.get("employmentType"):
        types = [job.get("employmentType")]
    labels = []
    for t in types:
        lab = EMP_LABEL.get(str(t), "")
        if lab and lab not in labels:
            labels.append(lab)
    return "·".join(labels[:2])


def short_location(raw: str) -> str:
    s = re.sub(r"\s+", " ", (raw or "")).strip()
    if not s:
        return ""
    # "서울 용산구 ..." → "서울 용산구"
    parts = s.split(" ")
    if len(parts) >= 2:
        return " ".join(parts[:2])
    return parts[0][:20]


def abs_job_url(path: str, job_id: str) -> str:
    p = str(path or "").strip()
    if p.startswith("http://") or p.startswith("https://"):
        # strip tracking query for cleaner share; keep GI_Read id
        m = re.search(r"(https?://(?:www\.)?jobkorea\.co\.kr/Recruit/GI_Read/\d+)", p, re.I)
        return m.group(1) if m else p
    if p.startswith("/"):
        m = re.search(r"/Recruit/GI_Read/(\d+)", p, re.I)
        if m:
            return f"https://www.jobkorea.co.kr/Recruit/GI_Read/{m.group(1)}"
        return "https://www.jobkorea.co.kr" + p.split("?")[0]
    if job_id:
        return f"https://www.jobkorea.co.kr/Recruit/GI_Read/{job_id}"
    return HOME_URL


def fetch_popular() -> dict:
    req = Request(
        API_URL,
        headers={
            "User-Agent": UA,
            "Accept": "application/json",
            "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
            "Origin": "https://www.jobkorea.co.kr",
            "Referer": HOME_URL,
        },
    )
    with urlopen(req, context=CTX, timeout=45) as res:
        return json.loads(res.read().decode("utf-8"))


def build_preview(job: dict, deadline_iso: str, today: str) -> str:
    bits = []
    career = career_text(job)
    if career:
        bits.append(career)
    emp = employment_text(job)
    if emp:
        bits.append(emp)
    loc = short_location(str(job.get("workplaceLocation") or ""))
    if loc:
        bits.append(loc)
    always = bool(job.get("alwaysHire"))
    dd = dday_label(deadline_iso, today, always)
    if dd:
        bits.append(dd if dd == "상시채용" else f"마감 {dd}")
    if deadline_iso and deadline_iso < "2069-01-01" and not always:
        bits.append(f"접수마감 {deadline_iso.replace('-', '.')}")
    return " · ".join(bits) if bits else "잡코리아 인기 채용 공고"


def parse_notices(payload: dict, today: str) -> list:
    type_info = payload.get("type") or {}
    if str(type_info.get("code") or "").upper() != "POPULAR":
        raise SystemExit(f"unexpected curated type: {type_info!r}")

    job_list = payload.get("jobList")
    if not isinstance(job_list, list):
        raise SystemExit("jobList missing")

    notices = []
    seen = set()
    for rank, row in enumerate(job_list, start=1):
        if not isinstance(row, dict):
            continue
        company = row.get("company") or {}
        job = row.get("job") or {}
        job_id = str(job.get("jobId") or "").strip()
        title = re.sub(r"\s+", " ", str(job.get("title") or "")).strip()
        company_name = re.sub(r"\s+", " ", str(company.get("companyName") or "")).strip()
        if not job_id or not title or len(title) < 2 or not company_name:
            continue
        if job_id in seen:
            continue
        seen.add(job_id)

        date_iso = date_only(job.get("firstPostedAt"))
        if not date_iso:
            continue
        # 미래 등록일은 오류로 보고 제외
        if date_iso > today:
            print(f"skip future date {job_id} {date_iso}")
            continue

        deadline_iso = date_only(job.get("applicationEndAt"))
        always = bool(job.get("alwaysHire"))
        if always or (deadline_iso and deadline_iso >= "2069-01-01"):
            deadline_iso = ""
            always = True

        try:
            score = float(job.get("score")) if job.get("score") is not None else None
        except (TypeError, ValueError):
            score = None

        url = abs_job_url(str(job.get("jobUrl") or ""), job_id)
        preview = build_preview(job, deadline_iso, today)
        key = f"{job_id}|{title}|{date_iso}"
        notices.append(
            {
                "id": hashlib.sha1(key.encode()).hexdigest()[:20],
                "jobId": job_id,
                "companyName": company_name,
                "title": title,
                "preview": preview[:160],
                "url": url,
                "dateISO": date_iso,
                "dateText": date_iso.replace("-", "."),
                "deadlineISO": deadline_iso,
                "deadlineText": deadline_iso.replace("-", ".") if deadline_iso else "",
                "alwaysHire": always,
                "popularRank": rank,
                "popularScore": score,
            }
        )

    # 인기 JOB 집합을 최신 등록일 순으로 정렬 (같으면 인기 순위 유지)
    notices.sort(key=lambda x: (x["dateISO"], -int(x["popularRank"])), reverse=True)
    return notices


def main():
    payload = fetch_popular()
    today = seoul_today()
    notices = parse_notices(payload, today)
    print(f"popular_jobs={len(notices)} type={payload.get('type')}")

    out = {
        "source": HOME_URL,
        "api": API_URL,
        "section": "인기 JOB",
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "today": today,
        "count": len(notices),
        "notices": notices,
    }

    js_path = ROOT / "jobkorea-board-data.js"
    json_path = ROOT / "data" / "jobkorea-notices.json"
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    js_path.write_text(
        "window.JOBKOREA_BOARD_DATA="
        + json.dumps(out, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(f"wrote {len(notices)} items → {js_path.name}, {json_path.as_posix()}")
    for n in notices[:8]:
        print(
            n["dateISO"],
            f"#{n['popularRank']}",
            n["companyName"],
            "|",
            n["title"][:40],
        )


if __name__ == "__main__":
    main()
