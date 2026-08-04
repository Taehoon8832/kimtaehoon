# 김태훈닷컴

정적 사이트 + **GitHub Actions** 기반 대학 공지 게시판입니다.  
Apps Script 없이 동작합니다.

## 대학별 공지 안내 게시판

- 수집: `scripts/build_univ_notices.py` (입학처 HTML / Jina)
- 저장: `univ-board-data.js`, `data/univ-notices.json`
- 자동 갱신: `.github/workflows/univ-notices.yml` (3시간마다 + 수동 실행)
- 화면: `index.html`이 JSON을 주기적으로 다시 읽어 반영

### 로컬에서 공지 다시 수집

```bash
python scripts/build_univ_notices.py
# Jina 생략
USE_JINA=0 python scripts/build_univ_notices.py
```

### 배포

GitHub에 push하면 Actions가 공지 데이터를 갱신합니다.  
사이트는 `index.html` + `univ-board-data.js` + `data/univ-notices.json`이 함께 서빙되면 됩니다.
