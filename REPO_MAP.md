# REPO_MAP.md

이 문서는 새 작업자와 에이전트가 빠르게 안전한 진입점을 찾도록 돕는 얇은 구조 지도입니다.

## 먼저 읽기
- `README.md`: 개발 시작 순서와 주요 명령
- `AGENTS.md`: 제품 맥락, 운영 원칙, 문서 갱신 규칙
- `WORKFLOWS.md`: 반복 작업 절차
- `VALIDATION.md`: 변경 유형별 검증 게이트
- `memory.md`: 반복되는 환경 이슈와 운영 메모

## 런타임 진입점
- `manifest.json`
  - MV3 권한, background service worker, side panel 경로를 정의합니다.
- `background.js`
  - content script 등록, 우클릭 메뉴, 사이드패널 토글, 번역 브리지를 담당합니다.
- `content.js`
  - 페이지 번역 오케스트레이션의 메인 엔트리입니다.
- `sidepanel.html` + `sidepanel.js`
  - 사이드패널 UI 골격과 부트스트랩 엔트리입니다.

## 주요 디렉터리
- `content/`
  - DOM 수집, 번역 API/provider, 캐시, 진행률, 선택 텍스트 UX를 나눠 관리합니다.
- `modules/`
  - 사이드패널 기능 모듈 묶음입니다.
  - 번역: `translation.js`, `quick-translate.js`, `history.js`
  - 검색/진단: `search.js`, `search-targets.js`, `geo-*`
  - 설정/저장소: `settings.js`, `storage.js`, `provider-*`, `state.js`
  - 운영성: `error-center.js`, `tools.js`, `recurring.js`, `types.js`
- `styles/`
  - `tokens`, `layout`, `components`, `feature-panels`, `sidepanel`로 스타일 레이어를 나눕니다.
- `sidepanel/`
  - 패널 부트스트랩 보조 파일을 둡니다.
- `scripts/`
  - `check-js.mjs`: 기본 JS 문법 검증
  - `release-pack.mjs`: 릴리즈용 폴더와 zip 생성, 버전/`LAST_EDITED` 검증
  - `test-provider-models.mjs`: provider smoke test
- `icons/`
  - 확장 아이콘 에셋입니다.

## 작업 시작점
- 번역 UX와 선택 텍스트: `content/selection.js`, `modules/translation.js`, `modules/quick-translate.js`
- 페이지 진단: `modules/geo-tab.js`, `modules/geo-audit.js`, `modules/geo-ui.js`, `modules/geo-checklist.js`
- 설정과 provider: `modules/settings.js`, `modules/provider-catalog.js`, `modules/provider-client.js`, `content/provider.js`
- 저장과 마이그레이션: `modules/storage.js`
- 패널 탭 연결: `modules/tab-registry.js`, `modules/panel-tab-modules.js`

## 기본 검증 시작점
- `npm run check`
- `npm run release:pack`
- `npm run test:providers`

검증 규칙의 기준 문서는 `VALIDATION.md`입니다. 구조가 바뀌면 여기와 `AGENTS.md`를 같이 갱신합니다.
