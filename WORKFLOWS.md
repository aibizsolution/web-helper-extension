# WORKFLOWS.md

반복 작업을 길게 설명하기보다, 언제 어떤 검증을 거쳐 무엇을 남겨야 하는지 최소 절차만 고정합니다.

## 1. 기능 또는 UI 변경
트리거: 사이드패널 UI, 번역 흐름, 페이지 진단, 도구, 설정 같은 사용자 기능을 바꿀 때

절차:
1. `REPO_MAP.md`에서 해당 진입점과 관련 모듈을 확인합니다.
2. `DESIGN-GUIDE.md`와 기존 컴포넌트 패턴을 먼저 확인합니다.
3. 구현 후 `VALIDATION.md` 기준 검증을 수행합니다.
4. 사용자 흐름이나 문구가 바뀌면 `README.md`, `AGENTS.md`, `CHANGELOG.md`, `meta.js` 반영 여부를 점검합니다.

검증:
- 기본: `npm run check`
- lint만 빠르게 확인할 때: `npm run lint`
- 브라우저 실기동 검증은 사용자가 명시적으로 요청한 경우에만 수행
- provider 연동 변경이 섞이면: `.env.providers.local`이 있을 때만 `npm run test:providers`

산출물:
- 코드 변경
- 필요한 문서 갱신
- 변경 요약과 남은 리스크

## 2. 버그 수정
트리거: 재현 가능한 오류, 로그 경고, 회귀 이슈를 고칠 때

절차:
1. 증상이 어느 계층인지 먼저 분류합니다. `background`, `content`, `sidepanel/modules`, `provider`, `styles`
2. 관련 파일만 좁게 수정합니다.
3. 같은 증상을 다시 확인할 수 있는 최소 검증을 선택합니다.
4. 환경 특이점이나 반복 함정이면 `memory.md` 반영 여부를 점검합니다.

검증:
- 기본: `npm run check`
- lint만 빠르게 확인할 때: `npm run lint`
- 실기동 증상은 사용자가 브라우저 검증을 요청했을 때만 확인
- provider/API 증상이면: `.env.providers.local`이 있을 때만 `npm run test:providers`

산출물:
- 버그 수정
- 검증 결과
- 재발 방지용 메모 또는 문서 갱신 여부

## 3. 릴리스 준비
트리거: 버전업, 배포 직전 점검, 공유용 패키지 상태 확인

절차:
1. 요청에 명시된 버전이 있으면 그 버전으로, 없으면 패치 버전으로 올립니다.
2. `manifest.json`, `package.json`, `README.md`, `CHANGELOG.md`가 같은 버전을 가리키는지 확인합니다.
3. `meta.js` 날짜와 `README.md`의 마지막 정리가 릴리즈 당일인지 확인합니다.
4. `AGENTS.md`, `WORKFLOWS.md`, `VALIDATION.md` 반영 여부를 확인합니다.
5. `npm run release:pack`로 배포용 `release/` 폴더와 zip을 생성합니다.
6. unpacked 확장을 다시 로드하고 열린 탭을 새로고침해야 하는지 점검합니다.

검증:
- 필수: `npm run release:pack`
- 선택: `.env.providers.local`이 있을 때만 `npm run test:providers`

산출물:
- 릴리스 가능한 작업 트리
- `release/web-helper-extension-vX.Y.Z.zip`
- 릴리스 노트 또는 변경 기록

## 4. 문서 또는 운영 하네스 변경
트리거: CI, 검증 스크립트, 온보딩 문서, 운영 메모, 에이전트 지침을 바꿀 때

절차:
1. `README.md`, `AGENTS.md`, `REPO_MAP.md`, `WORKFLOWS.md`, `VALIDATION.md`, `memory.md` 중 어떤 문서를 갱신해야 하는지 먼저 정합니다.
2. 새 규칙은 가장 얇은 버전부터 추가합니다.
3. 문서와 실제 명령이 어긋나지 않는지 확인합니다.

검증:
- 문서만 바뀌면 링크와 절차를 수동 확인합니다.
- 스크립트나 CI가 바뀌면 `npm run check`를 실행합니다.

산출물:
- 갱신된 운영 문서 또는 스크립트
- 검증 결과
- 다음에 이어서 다룰 백로그가 있으면 짧게 남김
