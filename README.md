# 웹 도우미

웹페이지 번역, 텍스트 번역, 검색 보조, 페이지 진단, 브라우저 도구, 반복 체크리스트를 한 사이드패널에서 처리하는 Chrome 확장 프로그램입니다.

## 현재 버전
- 버전: `2.4.0`
- 마지막 정리: `2026-04-10`

## 개발 문서
- [AGENTS.md](./AGENTS.md)
- [REPO_MAP.md](./REPO_MAP.md)
- [WORKFLOWS.md](./WORKFLOWS.md)
- [VALIDATION.md](./VALIDATION.md)
- [memory.md](./memory.md)
- [CHANGELOG.md](./CHANGELOG.md)

## 주요 기능
- `번역`
  - 메인 탭 하나 안에서 `사이트 / 텍스트 / 기록` 서브탭으로 번역 작업을 묶어 제공합니다.
- `사이트 번역`
  - API Key 없이 빠르게 읽는 구글 번역과, 선택한 provider/model을 쓰는 AI 정밀 번역을 제공합니다.
- `텍스트 번역`
  - 짧은 텍스트를 직접 입력해 번역하고, 같은 서브탭에서 기록도 다시 볼 수 있습니다.
- `선택 텍스트 번역`
  - 드래그 액션바와 우클릭 메뉴에서 번역/복사/설명하기/검색을 빠르게 실행할 수 있습니다.
- `스마트 검색`
  - 검색 의도 기반 추천 검색문으로 여러 검색 엔진을 엽니다.
- `페이지 진단`
  - 검색 노출과 AI 노출 요소를 함께 점검합니다.
  - AI 해석은 `OpenRouter + openai/gpt-5-mini` 고정 모델로 생성합니다.
- `도구`
  - 브라우저 캐시/사이트 데이터 정리와 기간별 방문 TOP 확인을 제공합니다.
- `오류 센터`
  - 최근 오류/경고 로그 확인과 요약 복사, 로그 정리를 제공합니다.
- `반복관리`
  - 카테고리형 반복 체크리스트를 관리합니다.

## 개발 기준
- Node: `22` LTS
- 이 확장은 실행 자체에는 별도 빌드가 필요 없습니다.
- 기본 검증 명령은 `npm run check`이며, JS 문법 검사와 ESLint를 함께 수행합니다.
- lint만 빠르게 돌리려면 `npm run lint`를 사용합니다.
- provider smoke test는 `.env.providers.local`이 준비된 경우에만 `npm run test:providers`를 사용합니다.

## 개발 시작
1. Node `22` 환경을 맞춥니다. `nvm`을 쓴다면 루트에서 `nvm use`를 실행합니다.
2. 루트에서 `npm install`을 실행합니다.
3. Chrome에서 `chrome://extensions/`를 엽니다.
4. 우측 상단 `개발자 모드`를 켭니다.
5. `압축해제된 확장 프로그램 로드`를 눌러 이 폴더를 선택합니다.
6. 기본 검증으로 `npm run check`를 실행합니다.
7. lint만 반복 확인하고 싶다면 `npm run lint`를 실행합니다.
8. provider 연동을 바꿨다면 `.env.providers.example`을 참고해 `.env.providers.local`을 준비한 뒤 `npm run test:providers`를 실행합니다.

## 지원 AI provider
- `OpenRouter`
  - `google/gemini-3.1-flash-lite-preview`
  - `openai/gpt-5-nano`
- `OpenAI`
  - `gpt-5-nano`
- `Gemini`
  - `gemini-3.1-flash-lite-preview`

구글 번역은 별도 API Key 없이 동작합니다.  
AI 정밀 번역은 설정에서 provider API Key를 입력해야 사용할 수 있습니다.

## 기본 사용 흐름
1. `설정` 탭에서 필요한 provider API Key를 입력합니다.
2. `번역` 탭의 `사이트` 서브탭에서 provider와 모델을 고릅니다.
3. `구글 번역` 또는 `AI 정밀 번역`을 실행합니다.
4. 텍스트를 직접 번역하려면 같은 탭의 `텍스트` 서브탭을 사용합니다.
5. 필요하면 같은 탭의 `기록` 서브탭에서 최근 결과를 다시 엽니다.
6. 페이지에서 텍스트를 드래그하면 액션바로 번역/복사/설명하기/검색을 빠르게 실행할 수 있습니다.

## 업데이트와 로컬 확인
1. 최신 코드를 반영합니다.
2. `chrome://extensions/`에서 `웹 도우미`를 다시 로드합니다.
3. 이미 열려 있던 웹페이지 탭도 새로고침합니다.
4. 변경 유형에 맞는 검증은 `VALIDATION.md` 기준으로 수행합니다.

## 릴리스 전 확인
- `manifest.json` 버전 확인
- `meta.js` 날짜 확인
- `README.md`, `AGENTS.md`, `CHANGELOG.md` 반영 여부 확인
- `npm run check`
- 필요 시 `npm run test:providers`
