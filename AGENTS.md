# AGENTS.md

## 프로젝트 개요
- 제품명: `웹 도우미`
- 현재 버전 기준: `2.4.2`
- 스택: Chrome Extension Manifest V3 + Vanilla JS + Side Panel
- 목적: 웹페이지 번역, 텍스트 번역, 검색 보조, 페이지 진단, 브라우저 도구, 반복 체크리스트를 한 패널에서 제공하는 내부용 확장 프로그램
- 디자인 가이드: `DESIGN-GUIDE.md`

## 먼저 읽을 문서
- `README.md`
  - 개발 시작 순서와 기본 명령
- `REPO_MAP.md`
  - 실제 진입점과 주요 디렉터리 역할
- `WORKFLOWS.md`
  - 반복 작업 절차와 산출물 기준
- `VALIDATION.md`
  - 변경 유형별 검증 게이트
- `memory.md`
  - 반복되는 환경 이슈와 운영 메모

## 현재 사용자 기능
- `번역`
  - `사이트`: API Key 없이 빠르게 읽는 구글 번역과 AI 정밀 번역 제공
  - `텍스트`: 직접 텍스트 입력 번역과 기록 확인
  - `기록`: 최근 번역 기록 확인 및 재실행
  - 선택 텍스트 번역 결과 연계
- `검색`
  - 검색문 추천 및 다중 검색 엔진 열기
- `페이지 진단`
  - AI 해석은 `OpenRouter + openai/gpt-5-mini` 고정 모델 사용
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

## 핵심 아키텍처
- `background.js`
  - content script 등록, 선택 텍스트 우클릭 메뉴, 사이드패널 토글, 구글 번역 브리지를 담당한다.
- `content.js` + `content/*`
  - 페이지 번역 오케스트레이션, DOM 반영, 선택 텍스트 UX, 캐시를 담당한다.
- `sidepanel.html` + `sidepanel.js` + `modules/*`
  - 패널 초기화, 탭 레지스트리, 번역/검색/페이지 진단/도구/반복관리/설정/오류 센터 기능 모듈을 담당한다.
- `styles/*`
  - `tokens`, `layout`, `components`, `feature-panels`, `sidepanel` 레이어로 UI 스타일을 나눈다.

## 개발 기준
- Node 기준 버전은 `22` LTS다.
- 기본 검증은 `npm run check`다.
- provider smoke test는 `.env.providers.local`이 준비된 경우에만 `npm run test:providers`를 사용한다.
- 자세한 절차는 `WORKFLOWS.md`, 검증 게이트는 `VALIDATION.md`를 기준으로 삼는다.

## 중요 운영 원칙
- 사이드패널은 `window-level`, 번역 상태는 `tab-level`로 관리한다.
- 브라우저 테스트는 사용자가 명시적으로 요청할 때만 진행한다.
- `Playwright MCP` 브라우저는 `chrome://`, `chrome-extension://`, `file://` 접근이 막혀 있어 확장 자체의 실기동 UI 검증에는 쓰지 않는다.
- 확장 업데이트 직후 열린 탭에는 구버전 content script가 남을 수 있어 새로고침이 필요할 수 있다.
- UI 기준은 `모바일 대응`이 아니라 `데스크톱 Chrome 사이드패널 폭`이다.
- 소규모 기능 수정 요청은 `REPO_MAP.md` 기준 관련 엔트리포인트와 직접 연결된 파일만 먼저 읽고, 필요할 때만 범위를 넓힌다.
- 요청 범위, 대상 화면, 성공 기준이 모호해서 관련 후보가 여러 개면 추측으로 저장소 전체를 넓게 읽지 말고 사용자에게 먼저 확인한다.
- 반복되는 환경 이슈, 자주 틀리는 명령, 중요한 운영 결정만 `memory.md`에 남긴다.

## 업데이트 관리 규칙
- 사용자에게 보이는 UI, 기능, 문구가 바뀌면 같은 작업 안에서 `meta.js`의 `LAST_EDITED`를 당일 날짜로 반드시 갱신한다.
- 사용자 흐름, 설치 방법, 협업 방식이 바뀌면 `README.md`를 같이 갱신한다.
- 구조, 운영 원칙, 에이전트 작업 방식이 바뀌면 `AGENTS.md`와 관련 운영 문서를 같이 갱신한다.
- 저장소 진입점이나 구조가 바뀌면 `REPO_MAP.md`를 같이 갱신한다.
- 반복 절차가 바뀌면 `WORKFLOWS.md`를 같이 갱신한다.
- 검증 기준이 바뀌면 `VALIDATION.md`를 같이 갱신한다.
- 사용자 영향이 있는 변경은 `CHANGELOG.md`에 날짜 기준으로 남긴다.
- 릴리스 파일 생성, 배포 패키지 생성, 버전업 요청은 모두 버전 갱신 요청으로 본다.
- 릴리스 요청에 별도 버전 번호가 없으면 기본적으로 패치 버전을 올리고, `manifest.json`, `package.json`, `README.md`, `CHANGELOG.md`가 같은 버전을 가리키게 한다.
- 개발 환경 의존성이 생기거나 바뀌면 `package.json`과 필요한 스크립트를 같은 작업 안에서 갱신한다.
- 작업을 마무리하기 전에 `meta.js`, `README.md`, `AGENTS.md`, `REPO_MAP.md`, `WORKFLOWS.md`, `VALIDATION.md`, `memory.md`, `CHANGELOG.md` 반영 여부를 점검한다.

## UI/디자인 원칙
- 새 UI를 만들기 전에 `sidepanel.html`의 기존 패턴과 `DESIGN-GUIDE.md`를 먼저 확인한다.
- 서브탭은 기존 `translate-subtabs` / `translate-subtab` 패턴을 재사용한다.
- 항목은 그룹형으로 묶고, 카드 안에 카드 안에 카드를 넣는 중첩 섹션은 지양한다.
- 같은 역할의 컴포넌트는 탭이 달라도 같은 스타일을 유지한다.
- 설명 문구는 본문에 반복해서 늘어놓지 말고 기본적으로 툴팁을 우선한다.
- 공용 컴포넌트 클래스는 `vertical-tabbar`, `translate-subtabs`, `translate-subtab`, `translation-tooltip-icon`, `card`, `action-row`, `inline-select`, `chip` 재사용을 우선한다.

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

## 참고 메모
- 사용자 노출 이름은 `페이지 진단`이지만 내부 모듈명은 `geo-*`를 유지 중이다.
- provider smoke test 설정은 `.env.providers.local`에만 두고 커밋하지 않는다.
