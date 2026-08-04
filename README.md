# 김태훈닷컴

정적 사이트 + **GitHub Actions** 기반 대학 공지·채용 게시판입니다.  
Apps Script 없이 동작합니다.

## 대학별 공지 안내 게시판

- 수집: `scripts/build_univ_notices.py` (입학처 HTML / Jina)
- 저장: `univ-board-data.js`, `data/univ-notices.json`
- 자동 갱신: `.github/workflows/univ-notices.yml` (3시간마다 + 수동 실행)
- 화면: `index.html`이 JSON을 주기적으로 다시 읽어 반영

## 석박 채용 정보 게시판

- 수집: `scripts/build_recruit.py` ([진학프로 채용 목록](https://www.jinhakpro.com/recruit/list))
- 저장: `recruit-board-data.js`, `data/recruit-notices.json`
- 표시: 대학명 · 제목 · 내용(미리보기) · 날짜, 최신 등록순
- 같은 Actions 워크플로에서 함께 갱신

### 로컬에서 다시 수집

```bash
python scripts/build_univ_notices.py
# Jina 생략
USE_JINA=0 python scripts/build_univ_notices.py

python scripts/build_recruit.py
```

### 배포

GitHub에 push하면 Actions가 공지·채용 데이터를 갱신합니다.  
사이트는 `index.html`과 보드 데이터 JS/JSON이 함께 서빙되면 됩니다.
