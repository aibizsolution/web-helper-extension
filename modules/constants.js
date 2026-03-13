/**
 * 공용 상수 모듈
 * - 메시지 액션/포트 명/스토리지 키 등 문자열 상수를 중앙화
 */

import { getSelectionSearchTargets } from './search-targets.js';

export const PORT_NAMES = {
  PANEL: 'panel'
};

export const ACTIONS = {
  PING: 'PING',
  START_PAGE_TRANSLATION: 'START_PAGE_TRANSLATION',
  START_PRECISE_RETRANSLATION: 'START_PRECISE_RETRANSLATION',
  RESTORE_PAGE_ORIGINAL: 'RESTORE_PAGE_ORIGINAL',
  TRANSLATE_SELECTION: 'TRANSLATE_SELECTION',
  COPY_SELECTION: 'COPY_SELECTION',
  EXPLAIN_SELECTION: 'EXPLAIN_SELECTION',
  SEARCH_SELECTION: 'SEARCH_SELECTION',
  GET_PROGRESS_V2: 'GET_PROGRESS_V2',
  OPEN_QUICK_TRANSLATE_PANEL: 'OPEN_QUICK_TRANSLATE_PANEL',
  FAST_TRANSLATE_INDEXED_TEXT: 'FAST_TRANSLATE_INDEXED_TEXT',
  GET_TOTAL_CACHE_STATUS: 'getTotalCacheStatus',
  FETCH_HTML_FOR_BOT_AUDIT: 'FETCH_HTML_FOR_BOT_AUDIT',
  GET_CURRENT_HTML: 'GET_CURRENT_HTML',
  RUN_CLIENT_GEO_AUDIT: 'RUN_CLIENT_GEO_AUDIT',
  TRANSLATE_FULL_PAGE: 'translateFullPage',
  RESTORE_ORIGINAL: 'restoreOriginal',
  GET_TRANSLATION_STATE: 'getTranslationState',
  GET_TRANSLATED_TITLE: 'getTranslatedTitle',
  GET_CACHE_STATUS: 'getCacheStatus',
  CLEAR_CACHE_FOR_DOMAIN: 'clearCacheForDomain',
  AUDIT_GEO: 'auditGeo'
};

export const PORT_MESSAGES = {
  PROGRESS: 'progress',
  CANCEL_TRANSLATION: 'CANCEL_TRANSLATION'
};

export const STORAGE_KEYS = {
  DEBUG_LOG: 'debugLog',
  CACHE_TTL: 'cacheTTL',
  FEATURE_FLAGS: 'featureFlags',
  PENDING_QUICK_TRANSLATE: 'pendingQuickTranslate'
};

export const SELECTION_CONTEXT_MENU_ROOT_ID = 'wpt-selection-actions';

export const SELECTION_ACTIONS = [
  {
    key: 'translate',
    label: '번역',
    tone: 'primary',
    contextMenuId: 'wpt-selection-translate',
    messageAction: ACTIONS.TRANSLATE_SELECTION
  },
  {
    key: 'copy',
    label: '복사',
    tone: 'secondary',
    contextMenuId: 'wpt-selection-copy',
    messageAction: ACTIONS.COPY_SELECTION
  },
  {
    key: 'explain',
    label: '설명하기',
    tone: 'secondary',
    contextMenuId: 'wpt-selection-explain',
    messageAction: ACTIONS.EXPLAIN_SELECTION
  },
  {
    key: 'search',
    label: '검색',
    tone: 'secondary',
    contextMenuId: 'wpt-selection-search',
    submenu: true
  }
];

export const SELECTION_SEARCH_TARGETS = getSelectionSearchTargets().map((target) => ({
  key: target.key,
  label: target.label,
  contextMenuId: `wpt-selection-search-${target.key}`
}));

