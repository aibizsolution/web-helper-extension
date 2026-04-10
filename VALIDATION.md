# VALIDATION.md

이 문서는 변경 유형별 최소 검증 게이트를 고정합니다. 로컬과 CI가 같은 기준을 공유하되, provider 키가 필요한 검증은 계속 로컬 전용으로 둡니다.

## 개발 기준
- Node: `22` LTS
- 기본 설치: `npm install`
- CI 설치: `npm ci`

## 검증 매트릭스

| 변경 유형 | 필수 검증 | 추가 확인 |
| --- | --- | --- |
| 문서만 변경 | 링크와 절차를 수동 확인 | 문서가 `README.md`, `AGENTS.md`, `REPO_MAP.md`, `WORKFLOWS.md`, `VALIDATION.md`, `memory.md` 중 어디를 기준으로 삼는지 점검 |
| JS 로직 변경 | `npm run check` | 영향 파일이 `scripts/`라면 명령 진입 확인도 함께 수행 |
| UI / HTML / CSS 변경 | `npm run check` | 사용자가 브라우저 검증을 명시적으로 요청한 경우에만 별도 실기동 확인 |
| `manifest.json`, `background.js`, `content.js`, `content/*` 경계 변경 | `npm run check` | 사용자가 브라우저 검증을 명시적으로 요청한 경우에만 별도 실기동 확인 |
| provider 연동 변경 | `npm run check` | `.env.providers.local`이 있을 때만 `npm run test:providers` |
| 릴리스 준비 | `npm run release:pack` | `manifest.json`과 `package.json` 버전 일치, `meta.js`와 `README.md` 날짜/버전이 당일 기준 최신인지 함께 확인 |

## 명령 설명
- `npm run check`
  - 루트 JS 파일과 `content/`, `modules/`, `sidepanel/`, `scripts/` 아래 `.js`, `.mjs` 문법을 검사하고, ESLint 기준도 함께 확인합니다.
- `npm run lint`
  - ESLint flat config 기준으로 브라우저/확장 코드와 Node 스크립트를 점검합니다.
- `npm run test:providers`
  - `.env.providers.local`에 키가 있는 provider만 실제 API smoke test를 수행합니다.
- `npm run release:pack`
  - `npm run check` 후 배포용 `release/` 폴더와 zip을 생성합니다.
  - `manifest.json`과 `package.json` 버전이 다르거나 `meta.js`의 `LAST_EDITED`, `README.md`의 `현재 버전 / 마지막 정리`가 서울 기준 릴리즈 상태와 맞지 않으면 실패합니다.

## 실패 처리 원칙
- 같은 환경 오류를 같은 방식으로 반복 재시도하지 않습니다.
- 브라우저 실기동 검증이 막히면 원인과 우회 경로를 `memory.md`에 남길지 먼저 판단합니다.
- provider smoke test 실패는 키 누락, quota, 외부 API 오류를 먼저 의심하고 확장 코드 문제와 분리해 해석합니다.
