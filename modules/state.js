/**
 * Side Panel 전역 상태 관리
 *
 * 역할:
 * - 패널 세션 상태
 * - 현재 활성 브라우저 탭 컨텍스트
 * - 설정 임시 상태
 * - 번역 런타임 상태
 */

export let currentTabId = null;
export let permissionGranted = false;
export let settingsChanged = false;
export let originalSettings = {};
export let lastTranslateMode = 'cache';
export let lastHistoryCompletionMeta = { runId: null, ts: 0 };
export let translationState = createDefaultTranslationState();

export const portsByTab = new Map();
export const translateModeByTab = new Map();
export const translationStateByTab = new Map();
export const autoTranslateTriggeredByTab = new Map();

const panelSessionState = {
  activePanelTab: 'translate',
  activeTranslatePanel: 'page'
};

const activeBrowserContext = {
  tabId: null,
  permissionGranted: false,
  tabUrl: ''
};

const settingsDraftState = {
  changed: false,
  original: {}
};

function syncSettingsDraftState() {
  settingsDraftState.changed = settingsChanged;
  settingsDraftState.original = originalSettings;
}

function syncActiveBrowserContext() {
  activeBrowserContext.tabId = currentTabId;
  activeBrowserContext.permissionGranted = permissionGranted;
}

export function createDefaultTranslationState() {
  return {
    runId: '',
    state: 'inactive',
    phase: 'idle',
    priority: 0,
    totalSegments: 0,
    visibleSegments: 0,
    translatedSegments: 0,
    totalTexts: 0,
    translatedCount: 0,
    cachedCount: 0,
    cacheHits: 0,
    batchCount: 0,
    batchesDone: 0,
    batches: [],
    activeRequests: 0,
    etaMs: 0,
    activeMs: 0,
    failedBatches: 0,
    failedSegments: 0,
    lastError: '',
    provider: '',
    model: '',
    profile: 'fast',
    originalTitle: '',
    translatedTitle: '',
    previewText: ''
  };
}

export function getPanelSessionState() {
  return panelSessionState;
}

export function getActiveBrowserContext() {
  return activeBrowserContext;
}

export function getSettingsDraftState() {
  return settingsDraftState;
}

export function getCurrentTabId() {
  return currentTabId;
}

export function setCurrentTabId(tabId) {
  currentTabId = typeof tabId === 'number' ? tabId : null;
  syncActiveBrowserContext();
}

export function getPermissionGranted() {
  return permissionGranted;
}

export function setPermissionGranted(value) {
  permissionGranted = Boolean(value);
  syncActiveBrowserContext();
}

export function getSettingsChanged() {
  return settingsChanged;
}

export function setSettingsChanged(value) {
  settingsChanged = Boolean(value);
  syncSettingsDraftState();
}

export function getOriginalSettings() {
  return originalSettings;
}

export function setOriginalSettings(settings) {
  originalSettings = settings || {};
  syncSettingsDraftState();
}

export function getTranslationState() {
  return translationState;
}

export function setTranslationState(newState) {
  translationState = {
    ...createDefaultTranslationState(),
    ...(newState || {}),
    batches: Array.isArray(newState?.batches) ? [...newState.batches] : []
  };
}

export function resetTranslationState() {
  setTranslationState(createDefaultTranslationState());
}

export function getLastTranslateMode() {
  return lastTranslateMode;
}

export function setLastTranslateMode(mode) {
  lastTranslateMode = mode;
}

export function getLastHistoryCompletionMeta() {
  return lastHistoryCompletionMeta;
}

export function setLastHistoryCompletionMeta(meta) {
  lastHistoryCompletionMeta = meta || { runId: null, ts: 0 };
}

export function setActivePanelTab(tabName) {
  panelSessionState.activePanelTab = tabName || 'translate';
}

export function setActiveTranslatePanel(panelName) {
  panelSessionState.activeTranslatePanel = panelName || 'page';
}

export function updateActiveBrowserContext(patch = {}) {
  if (typeof patch.tabId === 'number' || patch.tabId === null) {
    currentTabId = patch.tabId;
    activeBrowserContext.tabId = patch.tabId;
  }

  if (typeof patch.permissionGranted === 'boolean') {
    permissionGranted = patch.permissionGranted;
    activeBrowserContext.permissionGranted = patch.permissionGranted;
  }

  if (typeof patch.tabUrl === 'string') {
    activeBrowserContext.tabUrl = patch.tabUrl;
  }
}

export function getPortForTab(tabId) {
  return portsByTab.get(tabId) || null;
}

export function setPortForTab(tabId, newPort) {
  if (typeof tabId !== 'number') {
    return;
  }

  if (newPort) {
    portsByTab.set(tabId, newPort);
    return;
  }

  portsByTab.delete(tabId);
}

export function removePortForTab(tabId, { disconnect = true } = {}) {
  const port = portsByTab.get(tabId);
  if (port && disconnect) {
    try {
      port.disconnect();
    } catch (_) {
      // noop
    }
  }

  portsByTab.delete(tabId);
}

syncSettingsDraftState();
syncActiveBrowserContext();
