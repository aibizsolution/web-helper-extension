# AGENTS.md

## 프로젝트 개요
- 제품명: `웹 도우미`
- 현재 버전 기준: `2.4.0`
- 스택: Chrome Extension Manifest V3 + Vanilla JS + Side Panel
- 목적: 웹페이지 번역, 텍스트 번역, 검색 보조, 페이지 진단, 브라우저 도구, 반복 체크리스트를 한 패널에서 제공하는 내부용 확장 프로그램
- 디자인 가이드: `DESIGN-GUIDE.md`

## 현재 사용자 기능
- `번역`
  - `사이트`: API Key 없이 빠르게 읽는 구글 번역과 AI 정밀 번역 제공
  - `텍스트`: 직접 텍스트 입력 번역과 기록 확인
  - `기록`: 최근 번역 기록 확인 및 재실행
  - 선택 텍스트 번역 결과 연계
- `검색`
  - 검색문 추천 및 다중 검색 엔진 열기
- `페이지 진단`
  - 검색/AI 노출 관점의 페이지 점검
- `도구`
  - 브라우저 캐시/사이트 데이터 정리
  - 기간별 방문 TOP 확인 및 새 탭 열기
- `오류 센터`
  - 최근 오류/경고 로그 확인
  - 오류 요약/로그 복사 및 로그 비우기
- `반복관리`
  - 카테고리형 반복 체크리스트
- `설정`
  - provider API Key
  - 자동 번역
  - 드래그 액션바 on/off
  - 선택 번역 엔진
  - 사이드패널 단축키 안내

## 현재 번역 엔진 구조

### 페이지 번역
- `구글 번역`
  - provider: `builtin-fast`
  - model: `google-web-mt`
  - API Key 불필요
- `AI 정밀 번역`
  - 현재 패널에서 선택한 provider/model 사용
  - 현재 사용자 노출 provider: `OpenRouter`, `OpenAI`, `Gemini`

### 선택 텍스트 번역
- 드래그 액션바와 우클릭 메뉴 모두 `번역 / 복사 / 설명하기 / 검색` 기능 축으로 맞춘다
- 설정의 `선택 번역 엔진`에 따라 동작
- 기본값: `구글 번역`
- 옵션: `현재 AI 설정`

### 캐시 원칙
- 문자열 캐시와 페이지 스냅샷 캐시는 `provider + model + profile + pipelineVersion` 기준으로 분리
- `구글 번역`은 캐시를 읽음
- `AI 정밀 번역`은 캐시를 읽지 않고 새 번역을 생성

## 디렉터리 구조
```text
chrome_ext_yt_ai/
├── manifest.json
├── background.js
├── content.js
├── content/
│   ├── bootstrap.js
│   ├── api.js
│   ├── provider.js
│   ├── cache.js
│   ├── industry.js
│   ├── dom.js
│   ├── title.js
│   ├── progress.js
│   └── selection.js
├── sidepanel.html
├── sidepanel.js
├── sidepanel/
│   └── bootstrap.js
├── styles/
│   ├── tokens.css
│   ├── layout.css
│   ├── components.css
│   ├── feature-panels.css
│   └── sidepanel.css
├── modules/
│   ├── constants.js
│   ├── panel-constants.js
│   ├── panel-dom.js
│   ├── state.js
│   ├── tab-registry.js
│   ├── panel-tab-modules.js
│   ├── ui-utils.js
│   ├── translation.js
│   ├── history.js
│   ├── quick-translate.js
│   ├── search.js
│   ├── geo-tab.js
│   ├── geo-audit.js
│   ├── geo-ui.js
│   ├── tools.js
│   ├── error-center.js
│   ├── recurring.js
│   ├── settings.js
│   ├── provider-catalog.js
│   ├── provider-client.js
│   ├── storage.js
│   └── flags.js
├── logger.js
├── meta.js
├── README.md
├── CHANGELOG.md
├── AGENTS.md
├── scripts/
│   └── test-provider-models.mjs
└── icons/
```

## 핵심 아키텍처

### background.js
- content script 등록
- 선택 텍스트 우클릭 메뉴
- 사이드패널 열기/닫기 토글
- 구글 번역 브리지
- 공용 `CONTENT_SCRIPT_FILES`, 세션 키 상수 재사용

### content.js + content/*
- 실제 페이지 번역 오케스트레이션
- 텍스트 수집, 배치 분할, DOM 반영, 원본 복원
- 선택 텍스트 번역 UI
- 캐시 읽기/쓰기

### sidepanel.js + modules/*
- 탭 레지스트리 초기화와 브라우저 탭 컨텍스트 동기화
- 번역 엔진 선택, 진행 상태, 기록, 설정 관리
- 검색/페이지 진단/도구/반복관리 각 기능 모듈화

### styles/*
- `tokens.css`: 색상, 간격, radius 같은 기본 토큰
- `layout.css`: 패널 레이아웃과 탭 컨테이너
- `components.css`: 공용 탭, 카드, 버튼, 폼 컴포넌트
- `feature-panels.css`: 기능 탭 전용 스타일

## 중요 운영 원칙
- 사이드패널은 `window-level`, 번역 상태는 `tab-level`로 관리
- 확장 업데이트 직후 열린 탭에는 구버전 content script가 남을 수 있어 새로고침이 필요할 수 있음
- 브라우저 테스트는 사용자가 명시적으로 요청할 때만 진행
- 릴리스 전 `manifest.json` 버전과 `meta.js` 날짜를 함께 확인
- 큰 구조 변경이 있으면 `README.md`와 `AGENTS.md`를 같이 갱신
- UI 기준은 `모바일 대응`이 아니라 `데스크톱 Chrome 사이드패널 폭`
- 새 PC 온보딩은 기본적으로 `clone -> npm install -> 압축해제된 확장 프로그램 로드 -> npm run check` 흐름으로 안내
- 개발 검증 스크립트는 `package.json` 기준으로 유지하고, 새 검증 흐름이 생기면 스크립트와 README를 같이 갱신

## 업데이트 관리 규칙
- 사용자에게 보이는 UI, 기능, 문구가 바뀌면 같은 작업 안에서 `meta.js`의 `LAST_EDITED`를 당일 날짜로 반드시 갱신한다.
- 사용자 흐름, 설치 방법, 협업 방식이 바뀌면 `README.md`를 같이 갱신한다.
- 구조, 운영 원칙, 에이전트 작업 방식이 바뀌면 `AGENTS.md`를 같이 갱신한다.
- 사용자 영향이 있는 변경은 `CHANGELOG.md`에 날짜 기준으로 반드시 남긴다.
- `manifest.json` 버전은 임의로 올리지 말고, 사용자가 릴리스/버전업을 요청했을 때만 갱신한다.
- 개발 환경 의존성이 생기거나 바뀌면 `package.json`과 필요한 스크립트를 같은 작업 안에서 반드시 갱신한다.
- 작업을 마무리하기 전에 `meta.js`, `README.md`, `AGENTS.md`, `CHANGELOG.md` 중 무엇을 업데이트해야 하는지 항상 먼저 점검한다.

## UI/디자인 원칙
- 새 UI를 만들기 전에 `sidepanel.html`의 기존 패턴과 `DESIGN-GUIDE.md`를 먼저 확인
- 서브탭은 기존 `translate-subtabs` / `translate-subtab` 패턴 재사용
- 항목은 그룹형으로 묶고, 카드 안에 카드 안에 카드를 넣는 중첩 섹션 지양
- 같은 역할의 컴포넌트는 탭이 달라도 같은 스타일 유지
- 설명 문구는 반복해서 본문에 늘어놓지 말고, 기본적으로 툴팁 우선
- 공용 컴포넌트 클래스는 `vertical-tabbar`, `translate-subtabs`, `translate-subtab`, `translation-tooltip-icon`, `card`, `action-row`, `inline-select`, `chip` 재사용 우선

## 자주 보는 파일
- 패널 UI: `sidepanel.html`
- 스타일 엔트리: `styles/sidepanel.css`
- 탭 레지스트리: `modules/tab-registry.js`, `modules/panel-tab-modules.js`
- 번역 탭 로직: `modules/translation.js`, `modules/quick-translate.js`
- 설정 로직: `modules/settings.js`
- 저장소/마이그레이션: `modules/storage.js`
- 페이지 번역 메인: `content.js`
- provider 호출: `content/provider.js`, `modules/provider-client.js`
- 선택 텍스트 번역: `content/selection.js`
- 메타/푸터: `meta.js`
- 변경 기록: `CHANGELOG.md`

## 배포 전 체크리스트
1. `manifest.json` 버전 확인
2. `meta.js`의 `LAST_EDITED` 확인
3. `README.md`, `AGENTS.md`, `CHANGELOG.md` 반영 여부 확인
4. 바뀐 JS 파일 `node --check`
5. API 키가 준비돼 있으면 `node scripts/test-provider-models.mjs`
6. unpacked 확장 기준이면 브라우저에서 `다시 로드` 후 열린 탭 새로고침
7. 커밋 후 원격 저장소에 push

## 참고 메모
- 사용자 노출 이름은 `페이지 진단`이지만 내부 모듈명은 `geo-*`를 유지 중
- provider smoke test 설정은 `.env.providers.local`에만 두고 커밋하지 않음
