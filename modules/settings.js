/**
 * Side Panel 설정 관리
 *
 * 역할:
 * - 프로바이더별 API Key 관리
 * - 멀티 프로바이더 설정 로드/저장
 * - 현재 페이지 캐시 상태 조회/삭제
 */

import { logInfo, logError, logDebug } from '../logger.js';
import {
  getCurrentTabId,
  setOriginalSettings,
  setSettingsChanged
} from './state.js';
import { showToast, ensurePageContentScript } from './ui-utils.js';
import {
  getApiKey as readActiveApiKey,
  getConfiguredProviders,
  getModel as readActiveModel,
  getSettingsForForm,
  saveExtensionSettings
} from './storage.js';
import { PROVIDER_CATALOG } from './provider-catalog.js';

const SIDE_PANEL_COMMAND_ID = 'open-side-panel';
const SIDE_PANEL_SHORTCUT_FALLBACK = 'Ctrl+Shift+Y';
const SIDE_PANEL_SHORTCUT_POLL_MS = 1200;
const API_DELETE_CONFIRM_TIMEOUT_MS = 2500;
const PROVIDER_API_INPUT_IDS = Object.values(PROVIDER_CATALOG).map((provider) => provider.apiKeyStorageKey);
let sidePanelShortcutPollTimer = null;
let lastRenderedShortcutLabel = '';
let lastRenderedShortcutAssigned = false;
const providerDeleteConfirmTimers = new Map();

/**
 * 저장된 활성 API Key 조회
 * @returns {Promise<string>} API Key
 */
export async function getApiKey() {
  return await readActiveApiKey();
}

/**
 * 저장된 활성 모델 조회
 * @returns {Promise<string>} 모델명
 */
export async function getModel() {
  return await readActiveModel();
}

/**
 * API Key UI 업데이트
 * 활성 프로바이더에 키가 있으면 번역 섹션을 보여준다.
 */
export async function updateApiKeyUI() {
  try {
    const configuredProviders = await getConfiguredProviders();
    const hasApiKey = configuredProviders.length > 0;

    const noApiKeyMessage = document.getElementById('noApiKeyMessage');
    const translateSection = document.getElementById('translateSection');

    if (translateSection) {
      translateSection.style.display = 'block';
      translateSection.dataset.hasApiKey = hasApiKey ? 'true' : 'false';
    }

    if (noApiKeyMessage) {
      noApiKeyMessage.style.display = hasApiKey ? 'none' : 'block';
    }
  } catch (error) {
    logError('sidepanel', 'API_KEY_CHECK_ERROR', 'API Key 확인 실패', {}, error);
  }
}

/**
 * 설정 탭 초기화
 */
export function initSettingsTab() {
  const inputs = document.querySelectorAll('#settingsTab input, #settingsTab select');
  inputs.forEach((input) => {
    input.addEventListener('input', handleSettingsFieldChanged);
    input.addEventListener('change', handleSettingsFieldChanged);
  });

  document.querySelectorAll('[data-action="clear-api-key"]').forEach((button) => {
    button.addEventListener('click', handleProviderApiKeyDelete);
  });

  document.getElementById('saveBtn')?.addEventListener('click', handleSaveSettings);
  document.getElementById('cancelBtn')?.addEventListener('click', async () => {
    await loadSettings();
    hideSaveBar();
  });

  document.getElementById('openShortcutSettingsBtn')?.addEventListener('click', handleOpenShortcutSettings);
  startSidePanelShortcutWatcher();
}

function handleSettingsFieldChanged(event) {
  const inputId = event?.target?.id;
  if (inputId && PROVIDER_API_INPUT_IDS.includes(inputId)) {
    const button = document.querySelector(`[data-action="clear-api-key"][data-target-input="${inputId}"]`);
    resetProviderApiDeleteButtonConfirm(button);
    syncProviderApiDeleteButtonState(inputId);
  }

  setSettingsChanged(true);
  showSaveBar();
}

/**
 * 설정 로드
 */
export async function loadSettings() {
  try {
    const formSettings = await getSettingsForForm();

    setOriginalSettings({ ...formSettings });

    setInputValue('openRouterApiKey', formSettings.openRouterApiKey);
    setInputValue('openAIApiKey', formSettings.openAIApiKey);
    setInputValue('geminiApiKey', formSettings.geminiApiKey);
    setCheckboxValue('autoTranslate', formSettings.autoTranslate);
    setCheckboxValue('selectionTranslateEnabled', formSettings.selectionTranslateEnabled);
    setInputValue('selectionTranslateMode', formSettings.selectionTranslateMode);
    setCheckboxValue('debugLog', formSettings.debugLog);
    syncAllProviderApiDeleteButtons();
    await updateApiKeyUI();
    await updateSidePanelShortcutUI();

    setSettingsChanged(false);
    hideSaveBar();
  } catch (error) {
    logError('sidepanel', 'SETTINGS_LOAD_ERROR', '설정 로드 실패', {}, error);
  }
}

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (input) {
    input.value = value || '';
  }
}

function setCheckboxValue(id, value) {
  const input = document.getElementById(id);
  if (input) {
    input.checked = Boolean(value);
  }
}

/**
 * 설정 저장 핸들러
 */
export async function handleSaveSettings() {
  try {
    const payload = {
      openRouterApiKey: getInputValue('openRouterApiKey'),
      openAIApiKey: getInputValue('openAIApiKey'),
      geminiApiKey: getInputValue('geminiApiKey'),
      autoTranslate: isChecked('autoTranslate'),
      selectionTranslateEnabled: isChecked('selectionTranslateEnabled'),
      selectionTranslateMode: getInputValue('selectionTranslateMode') || 'fast'
    };

    if (document.getElementById('debugLog')) {
      payload.debugLog = isChecked('debugLog');
    }

    const nextSettings = await saveExtensionSettings(payload);
    setOriginalSettings({ ...nextSettings });
    setSettingsChanged(false);
    hideSaveBar();
    await updateApiKeyUI();
    syncAllProviderApiDeleteButtons();
    await refreshTranslationConfigUI();

    showToast('설정이 저장되었습니다!');
    logInfo('sidepanel', 'SETTINGS_SAVED', '멀티 프로바이더 설정 저장 완료', {
      defaultProvider: nextSettings.defaultProvider,
      defaultModel: nextSettings.defaultModel,
      translationProfile: nextSettings.translationProfile
    });
  } catch (error) {
    logError('sidepanel', 'SETTINGS_SAVE_ERROR', '설정 저장 실패', {}, error);
    showToast('저장 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

function getInputValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function isChecked(id) {
  return !!document.getElementById(id)?.checked;
}

function showSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.add('active');
  }
}

function hideSaveBar() {
  const saveBar = document.getElementById('saveBar');
  if (saveBar) {
    saveBar.classList.remove('active');
  }
}

function syncProviderApiDeleteButtonState(inputId) {
  const input = document.getElementById(inputId);
  const button = document.querySelector(`[data-action="clear-api-key"][data-target-input="${inputId}"]`);

  if (!input || !button) {
    return;
  }

  const providerLabel = button.dataset.providerLabel || '프로바이더';
  const hasValue = Boolean(String(input.value || '').trim());
  const isConfirming = button.dataset.confirming === 'true';

  button.disabled = !hasValue;
  button.textContent = isConfirming ? '삭제 확인' : '삭제';
  button.classList.toggle('is-confirming', isConfirming && hasValue);
  button.title = hasValue
    ? `${providerLabel} API Key 삭제`
    : '삭제할 API Key 없음';

  if (!hasValue) {
    resetProviderApiDeleteButtonConfirm(button);
  }
}

function syncAllProviderApiDeleteButtons() {
  PROVIDER_API_INPUT_IDS.forEach((inputId) => {
    syncProviderApiDeleteButtonState(inputId);
  });
}

function resetProviderApiDeleteButtonConfirm(button) {
  if (!button) {
    return;
  }

  const inputId = button.dataset.targetInput || '';
  const timerId = providerDeleteConfirmTimers.get(inputId);
  if (timerId) {
    window.clearTimeout(timerId);
    providerDeleteConfirmTimers.delete(inputId);
  }

  button.dataset.confirming = 'false';
  button.textContent = '삭제';
  button.classList.remove('is-confirming');
}

function armProviderApiDeleteButton(button) {
  if (!button) {
    return;
  }

  const inputId = button.dataset.targetInput || '';
  resetProviderApiDeleteButtonConfirm(button);
  button.dataset.confirming = 'true';
  button.textContent = '삭제 확인';
  button.classList.add('is-confirming');

  const timerId = window.setTimeout(() => {
    resetProviderApiDeleteButtonConfirm(button);
    syncProviderApiDeleteButtonState(inputId);
  }, API_DELETE_CONFIRM_TIMEOUT_MS);

  providerDeleteConfirmTimers.set(inputId, timerId);
}

function handleProviderApiKeyDelete(event) {
  const button = event?.currentTarget;
  const inputId = button?.dataset?.targetInput;
  const providerLabel = button?.dataset?.providerLabel || '프로바이더';
  const input = inputId ? document.getElementById(inputId) : null;

  if (!input) {
    return;
  }

  if (!String(input.value || '').trim()) {
    syncProviderApiDeleteButtonState(inputId);
    showToast(`${providerLabel} API Key가 이미 비어 있습니다.`, 'error');
    return;
  }

  if (button?.dataset?.confirming !== 'true') {
    armProviderApiDeleteButton(button);
    showToast(`${providerLabel} API Key를 지우려면 삭제를 한 번 더 눌러주세요.`);
    return;
  }

  resetProviderApiDeleteButtonConfirm(button);
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();

  showToast(`${providerLabel} API Key를 비웠습니다. 저장을 눌러 반영하세요.`);
}

async function refreshTranslationConfigUI() {
  try {
    const { refreshTranslationConfigUI: refreshTranslationTabUI } = await import('./translation.js');
    await refreshTranslationTabUI({ updateButtons: true });
  } catch (error) {
    logDebug('sidepanel', 'TRANSLATION_UI_REFRESH_SKIPPED', '번역 UI 새로고침 생략', {
      error: error?.message || '알 수 없음'
    }, error);
  }
}

function formatShortcutLabel(shortcut) {
  return String(shortcut || '').trim() || '미지정';
}

function isSettingsTabActive() {
  return document.getElementById('settingsTab')?.classList.contains('active') === true;
}

function setShortcutUIState(valueEl, shortcut, isAssigned, { force = false } = {}) {
  if (!valueEl) {
    return;
  }

  if (!force && lastRenderedShortcutLabel === shortcut && lastRenderedShortcutAssigned === isAssigned) {
    return;
  }

  valueEl.textContent = shortcut;
  valueEl.classList.toggle('is-empty', !isAssigned);
  lastRenderedShortcutLabel = shortcut;
  lastRenderedShortcutAssigned = isAssigned;
}

async function updateSidePanelShortcutUI(options = {}) {
  const { force = false } = options;
  const valueEl = document.getElementById('sidePanelShortcutValue');

  if (!valueEl) {
    return;
  }

  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === SIDE_PANEL_COMMAND_ID);
    const shortcut = formatShortcutLabel(command?.shortcut);
    const isAssigned = shortcut !== '미지정';

    setShortcutUIState(valueEl, shortcut, isAssigned, { force });
  } catch (error) {
    setShortcutUIState(valueEl, SIDE_PANEL_SHORTCUT_FALLBACK, true, { force });
    logDebug('sidepanel', 'SHORTCUT_INFO_UNAVAILABLE', '단축키 정보를 가져오지 못했습니다.', {}, error);
  }
}

async function handleOpenShortcutSettings() {
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts', active: true });
    showToast('크롬 단축키 설정을 열었습니다.');
    await updateSidePanelShortcutUI({ force: true });
  } catch (error) {
    logError('sidepanel', 'SHORTCUT_SETTINGS_OPEN_FAILED', '크롬 단축키 설정 열기 실패', {}, error);
    showToast('chrome://extensions/shortcuts 에서 직접 변경해주세요.', 'error');
  }
}

function startSidePanelShortcutWatcher() {
  if (sidePanelShortcutPollTimer) {
    return;
  }

  const refreshIfNeeded = async ({ force = false } = {}) => {
    if (document.hidden) {
      return;
    }

    if (!force && !isSettingsTabActive()) {
      return;
    }

    await updateSidePanelShortcutUI({ force });
  };

  sidePanelShortcutPollTimer = window.setInterval(() => {
    void refreshIfNeeded();
  }, SIDE_PANEL_SHORTCUT_POLL_MS);

  window.addEventListener('focus', () => {
    void refreshIfNeeded({ force: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void refreshIfNeeded({ force: true });
    }
  });
}

/**
 * 현재 페이지(도메인)의 IndexedDB 캐시 상태 조회
 * @returns {Promise<{count: number, size: number}>} 캐시 항목 수와 총 용량(바이트)
 */
export async function getPageCacheStatus() {
  try {
    return await new Promise((resolve) => {
      const activeTabId = getCurrentTabId();
      if (!activeTabId) {
        resolve({ count: 0, size: 0 });
        return;
      }

      chrome.tabs.sendMessage(activeTabId, { action: 'getCacheStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ count: 0, size: 0 });
          return;
        }

        if (response?.success) {
          resolve({ count: response.count || 0, size: response.size || 0 });
          return;
        }

        resolve({ count: 0, size: 0 });
      });
    });
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_STATUS_ERROR', '캐시 조회 실패', {}, error);
    return { count: 0, size: 0 };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 현재 페이지 캐시 상태 UI 업데이트
 */
export async function updatePageCacheStatus() {
  try {
    const cacheManagementEl = document.getElementById('cacheManagement');
    const activeTabId = getCurrentTabId();

    if (!activeTabId) {
      if (cacheManagementEl) {
        cacheManagementEl.style.display = 'none';
      }
      return;
    }

    await ensurePageContentScript(activeTabId);

    const { count, size } = await getPageCacheStatus();
    const itemCountEl = document.getElementById('pageItemCount');
    const sizeDisplayEl = document.getElementById('pageSizeDisplay');

    if (itemCountEl) {
      itemCountEl.textContent = count.toLocaleString();
    }

    if (sizeDisplayEl) {
      sizeDisplayEl.textContent = formatBytes(size);
    }

    if (cacheManagementEl) {
      cacheManagementEl.style.display = 'block';
    }
  } catch (error) {
    logDebug('sidepanel', 'PAGE_CACHE_STATUS_UPDATE_ERROR', '캐시 상태 업데이트 실패', {
      error: error?.message || '알 수 없음'
    });
  }
}

/**
 * 현재 페이지 캐시 삭제 핸들러
 */
export async function handleClearPageCache() {
  try {
    const activeTabId = getCurrentTabId();
    if (!activeTabId) {
      showToast('현재 탭을 확인할 수 없습니다.', 'error');
      return;
    }

    await ensurePageContentScript(activeTabId);

    chrome.tabs.sendMessage(activeTabId, { action: 'clearCacheForDomain' }, (response) => {
      if (chrome.runtime.lastError) {
        logError('sidepanel', 'PAGE_CACHE_CLEAR_MSG_ERROR', '캐시 삭제 메시지 실패', {
          tabId: activeTabId,
          error: chrome.runtime.lastError.message
        }, chrome.runtime.lastError);
        showToast('캐시 삭제 중 오류가 발생했습니다.', 'error');
        return;
      }

      if (response?.success) {
        showToast('이 페이지의 캐시가 삭제되었습니다.');
        updatePageCacheStatus();
      } else {
        logError('sidepanel', 'PAGE_CACHE_CLEAR_FAILED', '캐시 삭제 실패', {
          tabId: activeTabId,
          responseError: response?.error || 'unknown'
        });
        showToast(`캐시 삭제 중 오류가 발생했습니다.${response?.error ? ` (${response.error})` : ''}`, 'error');
      }
    });
  } catch (error) {
    logError('sidepanel', 'PAGE_CACHE_CLEAR_ERROR', '캐시 삭제 실패', {}, error);
    showToast('캐시 삭제 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}

/**
 * 설정 화면에서 프로바이더 이름 목록을 반환한다.
 * 번역 탭에서 재사용한다.
 * @returns {Array<object>} 프로바이더 목록
 */
export function getProviderOptions() {
  return Object.values(PROVIDER_CATALOG).map((provider) => ({
    value: provider.id,
    label: provider.label
  }));
}
