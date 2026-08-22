# 김태훈닷컴

정적 사이트 + **GitHub Actions** 기반 대학 공지·채용 게시판입니다.  
Apps Script 없이 동작합니다.

## 실시간 갱신

- 화면: `index.html`이 `data/*.json`을 **1분마다** 다시 읽어 반영 (탭 복귀 시에도 즉시 갱신)
- **서울 자정**에 날짜가 바뀌면 “오늘” 배지·건수·D-day를 즉시 다시 그리고, 보드 JSON을 조용히 재요청
- 오늘자 글은 상단 정렬 + **오늘** 배지 + 건수 표시
- 목록이 실제로 바뀌면 토스트로 알림
- 수집 실패 시 **이전 정상 데이터를 유지**하고 Actions는 깨지지 않음 (빈 데이터로 덮어쓰지 않음)
- Actions는 `cancel-in-progress: false` + 순차 수집으로 중간 취소·push 충돌을 줄임

| 게시판 | 수집 주기 (Actions) | 워크플로 |
|--------|---------------------|----------|
| 채용 공고 (잡코리아) | **5분** | `refresh-boards.yml` |
| 석박 채용 (진학프로) | **10분** + 2시간 Windows 재시도 | `recruit-notices.yml` |
| 대학별 공지 | **1시간** | `univ-notices.yml` |

## 대학별 공지 안내 게시판

- 수집: `scripts/build_univ_notices.py` (입학처 HTML / Jina)
- 저장: `univ-board-data.js`, `data/univ-notices.json`
- 자동 갱신: `.github/workflows/univ-notices.yml` (1시간마다 + 수동 실행)

## 석박 채용 정보 게시판

- 수집: `scripts/build_recruit.py` ([진학프로 채용 목록](https://www.jinhakpro.com/recruit/list))
- 저장: `recruit-board-data.js`, `data/recruit-notices.json`
- 표시: 대학명 · 제목 · 내용(미리보기) · 날짜, 최신 등록순

## 채용 공고 게시판

- 수집: `scripts/build_jobkorea.py` (잡코리아 인기 JOB API)
- 저장: `jobkorea-board-data.js`, `data/jobkorea-notices.json`

### 로컬에서 다시 수집

```bash
python scripts/build_univ_notices.py
# Jina 생략
USE_JINA=0 python scripts/build_univ_notices.py

python scripts/build_recruit.py
python scripts/build_jobkorea.py

# 채용·석박만 한 번에 (Node)
node scripts/refresh_boards.mjs
```

### 배포

GitHub에 push하면 Actions가 공지·채용 데이터를 갱신합니다.  
사이트는 `index.html`과 보드 데이터 JS/JSON이 함께 서빙되면 됩니다.
