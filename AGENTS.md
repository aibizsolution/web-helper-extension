# AGENTS.md

## 프로젝트 개요
- 제품명: `웹 도우미`
- 현재 버전 기준: `2.4.0`
- 스택: Chrome Extension Manifest V3 + Vanilla JS + Side Panel
- 목적: 웹페이지 번역, 텍스트 번역, 검색 보조, SEO 진단, 반복 체크리스트를 한 패널에서 제공하는 내부용 확장 프로그램

## 현재 사용자 기능
- `번역`
  - `초고속 번역`: API Key 없이 현재 페이지를 빠르게 읽을 수 있게 번역
  - `AI 정밀 번역`: 현재 선택한 provider/model로 의미 보존을 우선한 페이지 번역
  - `번역 기록`: 번역 탭 내부 서브탭으로 최근 번역 기록 확인 및 재실행
- `텍스트`
  - 직접 텍스트 입력 번역
  - 선택 텍스트 번역 결과 연계
- `검색`
  - 검색문 추천 및 다중 검색 엔진 열기
- `SEO 검사`
  - 검색/AI 노출 관점의 페이지 점검
- `반복관리`
  - 카테고리형 반복 체크리스트
- `설정`
  - provider API Key
  - 자동 번역
  - 선택 텍스트 번역 on/off
  - 선택 번역 엔진
  - 사이드패널 단축키 안내

## 현재 번역 엔진 구조

### 페이지 번역
- `초고속 번역`
  - provider: `builtin-fast`
  - model: `google-web-mt`
  - API Key 불필요
- `AI 정밀 번역`
  - 현재 패널에서 선택한 provider/model 사용
  - 현재 사용자 노출 provider: `OpenRouter`, `OpenAI`, `Gemini`

### 선택 텍스트 번역
- 설정의 `선택 번역 엔진`에 따라 동작
- 기본값: `초고속`
- 옵션: `현재 AI 설정`

### 캐시 원칙
- 문자열 캐시와 페이지 스냅샷 캐시는 `provider + model + profile + pipelineVersion` 기준으로 분리
- `초고속 번역`은 캐시를 읽음
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
├── modules/
│   ├── constants.js
│   ├── state.js
│   ├── ui-utils.js
│   ├── translation.js
│   ├── history.js
│   ├── quick-translate.js
│   ├── search.js
│   ├── geo-tab.js
│   ├── geo-audit.js
│   ├── geo-ui.js
│   ├── recurring.js
│   ├── settings.js
│   ├── provider-catalog.js
│   ├── provider-client.js
│   ├── storage.js
│   └── flags.js
├── logger.js
├── meta.js
├── README.md
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
- 초고속 번역 브리지

### content.js + content/*
- 실제 페이지 번역 오케스트레이션
- 텍스트 수집, 배치 분할, DOM 반영, 원본 복원
- 선택 텍스트 번역 UI
- 캐시 읽기/쓰기

### sidepanel.js + modules/*
- 탭 전환과 패널 초기화
- 번역 엔진 선택, 진행 상태, 기록, 설정 관리
- 검색/SEO 검사/반복관리 각 기능 모듈화

## 중요 운영 원칙
- 사이드패널은 `window-level`, 번역 상태는 `tab-level`로 관리
- 확장 업데이트 직후 열린 탭에는 구버전 content script가 남을 수 있어 새로고침이 필요할 수 있음
- 브라우저 테스트는 사용자가 명시적으로 요청할 때만 진행
- 릴리스 전 `manifest.json` 버전과 `meta.js` 날짜를 함께 확인
- 큰 구조 변경이 있으면 `README.md`와 `AGENTS.md`를 같이 갱신

## 자주 보는 파일
- 패널 UI: `sidepanel.html`
- 번역 탭 로직: `modules/translation.js`
- 설정 로직: `modules/settings.js`
- 저장소/마이그레이션: `modules/storage.js`
- 페이지 번역 메인: `content.js`
- provider 호출: `content/provider.js`, `modules/provider-client.js`
- 선택 텍스트 번역: `content/selection.js`
- 메타/푸터: `meta.js`

## 배포 전 체크리스트
1. `manifest.json` 버전 확인
2. `meta.js`의 `LAST_EDITED` 확인
3. 바뀐 JS 파일 `node --check`
4. API 키가 준비돼 있으면 `node scripts/test-provider-models.mjs`
5. unpacked 확장 기준이면 브라우저에서 `다시 로드` 후 열린 탭 새로고침
6. 커밋 후 원격 저장소에 push

## 참고 메모
- 사용자 노출 이름은 `SEO 검사`지만 내부 모듈명은 `geo-*`를 유지 중
- provider smoke test 설정은 `.env.providers.local`에만 두고 커밋하지 않음
