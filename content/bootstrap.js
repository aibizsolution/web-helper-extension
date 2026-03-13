/**
 * Content Script Bootstrap (foldered)
 * - 전역 네임스페이스(WPT) 및 공용 상수 정의
 * - 이후 로직 스크립트(content.js 등)가 의존
 */
(function bootstrap() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    if (!WPT.Constants) {
      WPT.Constants = {
        PORT_NAMES: { PANEL: 'panel' },
        PORT_MESSAGES: { PROGRESS: 'progress', CANCEL_TRANSLATION: 'CANCEL_TRANSLATION' },
        ACTIONS: {
          PING: 'PING',
          START_PAGE_TRANSLATION: 'START_PAGE_TRANSLATION',
          START_PRECISE_RETRANSLATION: 'START_PRECISE_RETRANSLATION',
          RESTORE_PAGE_ORIGINAL: 'RESTORE_PAGE_ORIGINAL',
          TRANSLATE_SELECTION: 'TRANSLATE_SELECTION',
          COPY_SELECTION: 'COPY_SELECTION',
          EXPLAIN_SELECTION: 'EXPLAIN_SELECTION',
          GET_PROGRESS_V2: 'GET_PROGRESS_V2',
          OPEN_QUICK_TRANSLATE_PANEL: 'OPEN_QUICK_TRANSLATE_PANEL',
          TRANSLATE_FULL_PAGE: 'translateFullPage',
          RESTORE_ORIGINAL: 'restoreOriginal',
          GET_TRANSLATION_STATE: 'getTranslationState',
          GET_TRANSLATED_TITLE: 'getTranslatedTitle',
          GET_CACHE_STATUS: 'getCacheStatus',
          CLEAR_CACHE_FOR_DOMAIN: 'clearCacheForDomain'
        },
        STORAGE_KEYS: {
          PENDING_QUICK_TRANSLATE: 'pendingQuickTranslate'
        },
        SELECTION_ACTIONS: [
          { key: 'translate', label: '번역', tone: 'primary', messageAction: 'TRANSLATE_SELECTION' },
          { key: 'copy', label: '복사', tone: 'secondary', messageAction: 'COPY_SELECTION' },
          { key: 'explain', label: '설명하기', tone: 'secondary', messageAction: 'EXPLAIN_SELECTION' }
        ]
      };
    }
  } catch (_) {
    // 부트스트랩 실패는 런타임에서 content.js가 자체 보호로 동작
  }
})();

