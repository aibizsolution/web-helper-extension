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
  currentTabId,
  setOriginalSettings,
  setSettingsChanged
} from './state.js';
import { showToast, ensurePageContentScript, handleCopyLogs } from './ui-utils.js';
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

  document.getElementById('saveBtn')?.addEventListener('click', handleSaveSettings);
  document.getElementById('cancelBtn')?.addEventListener('click', async () => {
    await loadSettings();
    hideSaveBar();
  });

  document.getElementById('copyAllLogsBtn')?.addEventListener('click', () => handleCopyLogs('all'));
  document.getElementById('copyErrorLogsBtn')?.addEventListener('click', () => handleCopyLogs('errors'));
  document.getElementById('openShortcutSettingsBtn')?.addEventListener('click', handleOpenShortcutSettings);
}

function handleSettingsFieldChanged() {
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

function formatShortcutLabel(shortcut) {
  return String(shortcut || '').trim() || '미지정';
}

async function updateSidePanelShortcutUI() {
  const valueEl = document.getElementById('sidePanelShortcutValue');

  if (!valueEl) {
    return;
  }

  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === SIDE_PANEL_COMMAND_ID);
    const shortcut = formatShortcutLabel(command?.shortcut);
    const isAssigned = shortcut !== '미지정';

    valueEl.textContent = shortcut;
    valueEl.classList.toggle('is-empty', !isAssigned);
  } catch (error) {
    valueEl.textContent = SIDE_PANEL_SHORTCUT_FALLBACK;
    valueEl.classList.remove('is-empty');
    logDebug('sidepanel', 'SHORTCUT_INFO_UNAVAILABLE', '단축키 정보를 가져오지 못했습니다.', {}, error);
  }
}

async function handleOpenShortcutSettings() {
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts', active: true });
    showToast('크롬 단축키 설정을 열었습니다.');
    await updateSidePanelShortcutUI();
  } catch (error) {
    logError('sidepanel', 'SHORTCUT_SETTINGS_OPEN_FAILED', '크롬 단축키 설정 열기 실패', {}, error);
    showToast('chrome://extensions/shortcuts 에서 직접 변경해주세요.', 'error');
  }
}

/**
 * 현재 페이지(도메인)의 IndexedDB 캐시 상태 조회
 * @returns {Promise<{count: number, size: number}>} 캐시 항목 수와 총 용량(바이트)
 */
export async function getPageCacheStatus() {
  try {
    return await new Promise((resolve) => {
      if (!currentTabId) {
        resolve({ count: 0, size: 0 });
        return;
      }

      chrome.tabs.sendMessage(currentTabId, { action: 'getCacheStatus' }, (response) => {
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

    if (!currentTabId) {
      if (cacheManagementEl) {
        cacheManagementEl.style.display = 'none';
      }
      return;
    }

    await ensurePageContentScript(currentTabId);

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
    if (!currentTabId) {
      showToast('현재 탭을 확인할 수 없습니다.', 'error');
      return;
    }

    await ensurePageContentScript(currentTabId);

    chrome.tabs.sendMessage(currentTabId, { action: 'clearCacheForDomain' }, (response) => {
      if (chrome.runtime.lastError) {
        logError('sidepanel', 'PAGE_CACHE_CLEAR_MSG_ERROR', '캐시 삭제 메시지 실패', {
          tabId: currentTabId,
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
          tabId: currentTabId,
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
