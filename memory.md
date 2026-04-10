# memory.md

운영 메모는 반복되는 환경 이슈, 자주 틀리는 명령, 중요한 결정만 짧게 남깁니다.

권장 형식:
- 날짜
- 신호
- 결정
- 상태

## 2026-04-10
- 신호: `Playwright MCP` 브라우저는 `chrome://`, `chrome-extension://`, `file://` 접근이 막혀 확장 자체의 실기동 UI 검증에 바로 쓰기 어렵다.
  결정: 브라우저 실기동 검증은 기본 절차에 넣지 않고, 사용자가 명시적으로 요청한 경우에만 별도 수행한다.
  상태: active

- 신호: provider smoke test는 실제 API 키가 있어야 하며 로컬 환경마다 준비 상태가 다르다.
  결정: `.env.providers.local`만 읽고, 이 파일은 커밋하지 않는다.
  상태: active

- 신호: unpacked 확장을 다시 로드해도 이미 열려 있던 탭에는 구버전 content script가 남을 수 있다.
  결정: 확장 업데이트 직후에는 `chrome://extensions/`에서 다시 로드한 뒤 열린 웹페이지 탭도 새로고침한다.
  상태: active
