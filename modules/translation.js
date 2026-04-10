/**
 * Side Panel 번역 핵심 로직
 *
 * 역할:
 * - V2 페이지 번역 시작/복원
 * - 번역 탭 상단 provider/model 설정 관리
 * - 권한 및 content script 준비 확인
 * - Port 기반 진행 상태 동기화
 */

import { logInfo, logDebug, logError } from '../logger.js';
import { ACTIONS, PORT_MESSAGES, PORT_NAMES } from './constants.js';
import {
  autoTranslateTriggeredByTab,
  createDefaultTranslationState,
  getCurrentTabId,
  getPermissionGranted,
  getPortForTab,
  getTranslationState,
  removePortForTab,
  setCurrentTabId,
  setPermissionGranted,
  setPortForTab,
  setTranslationState,
  translationStateByTab,
  translateModeByTab
} from './state.js';
import { updateUI, resetTranslateUI, showToast, ensurePageContentScript } from './ui-utils.js';
import { handleTranslationCompletedForHistory } from './history.js';
import { updateApiKeyUI, updatePageCacheStatus } from './settings.js';
import { CONTENT_SCRIPT_FILES } from './panel-constants.js';
import { escapeHtml, renderTooltipIcon } from './panel-dom.js';
import {
  DEFAULT_PROFILE,
  FAST_PAGE_ENGINE_LABEL,
  FAST_PAGE_MODEL,
  FAST_PAGE_PROVIDER,
  PROVIDER_CATALOG,
  getDefaultModelForProvider
} from './provider-catalog.js';
import { getActiveTranslationConfig, getConfiguredProviders, updateActiveTranslationConfig } from './storage.js';

const EXPECTED_CONTENT_RUNTIME_VERSION = '2026-03-13-content-v4';
const CONTENT_READY_STATUS = {
  READY: 'ready',
  MISSING: 'missing',
  VERSION_MISMATCH: 'version_mismatch'
};
const CONTENT_RELOAD_TIMEOUT_MS = 20000;

function currentTabIdValue() {
  return getCurrentTabId();
}

function permissionGrantedValue() {
  return getPermissionGranted();
}

function translationStateValue() {
  return getTranslationState();
}

/**
 * 번역 탭 상단 컨트롤 초기화
 */
export async function initTranslationTab() {
  bindTranslationActionButtons();
  bindTranslationConfigControls();
  await refreshTranslationConfigUI();
}

export async function refreshTranslationConfigUI(options = {}) {
  const shouldUpdateButtons = options.updateButtons === true;
  await syncTranslationConfigControls();
  await updateApiKeyUI();
  updateTranslationConfigSummary();
  if (shouldUpdateButtons) {
    updateUIByPermission();
  }
}

function bindTranslationActionButtons() {
  document.getElementById('fastTranslateBtn')?.addEventListener('click', () => handleTranslationAction('fast'));
  document.getElementById('preciseTranslateBtn')?.addEventListener('click', () => handleTranslationAction('precise'));
}

function isRestoreToggleState(profile) {
  const currentState = translationStateValue();
  const currentProfile = currentState.profile === 'precise' ? 'precise' : 'fast';
  if (currentProfile !== profile) {
    return false;
  }

  return ['analyzing', 'translating', 'completed', 'completed_with_errors', 'error'].includes(currentState.state);
}

async function handleTranslationAction(profile) {
  logInfo('sidepanel', 'TRANSLATION_ACTION_CLICKED', '번역 액션 버튼 클릭', {
    requestedProfile: profile,
    currentState: translationStateValue().state,
    currentProfile: translationStateValue().profile,
    tabId: currentTabIdValue()
  });

  if (isRestoreToggleState(profile)) {
    logInfo('sidepanel', 'TRANSLATION_ACTION_RESTORE', '번역 버튼이 원본 보기로 전환되어 복원 실행', {
      requestedProfile: profile,
      tabId: currentTabIdValue()
    });
    await handleRestore();
    return;
  }

  await handleStartPageTranslation(profile);
}

function bindTranslationConfigControls() {
  const providerSelect = document.getElementById('translationProviderSelect');
  const modelSelect = document.getElementById('translationModelSelect');

  providerSelect?.addEventListener('change', async () => {
    const provider = providerSelect.value;
    populateModelSelect(provider, getDefaultModelForProvider(provider));
    const currentConfig = await getActiveTranslationConfig();
    await updateActiveTranslationConfig({
      provider,
      model: document.getElementById('translationModelSelect')?.value || getDefaultModelForProvider(provider),
      profile: currentConfig.profile || DEFAULT_PROFILE
    });
    await updateApiKeyUI();
    updateTranslationConfigSummary();
  });

  modelSelect?.addEventListener('change', async () => {
    const currentConfig = await getActiveTranslationConfig();
    await updateActiveTranslationConfig({
      provider: document.getElementById('translationProviderSelect')?.value,
      model: modelSelect.value,
      profile: currentConfig.profile || DEFAULT_PROFILE
    });
    updateTranslationConfigSummary();
  });
}

async function syncTranslationConfigControls() {
  const config = await getActiveTranslationConfig();
  const providerSelect = document.getElementById('translationProviderSelect');
  const modelSelect = document.getElementById('translationModelSelect');
  const configuredProviders = await getConfiguredProviders();

  if (!providerSelect || !modelSelect) {
    return;
  }

  if (configuredProviders.length === 0) {
    providerSelect.innerHTML = '<option value="">API Key 입력 필요</option>';
    providerSelect.disabled = true;
    modelSelect.innerHTML = '<option value="">설정에서 프로바이더 API Key 입력</option>';
    modelSelect.disabled = true;
    updateTranslationConfigSummary();
    return;
  }

  providerSelect.disabled = false;
  modelSelect.disabled = false;
  providerSelect.innerHTML = configuredProviders
    .map((provider) => `<option value="${provider.id}">${provider.label}</option>`)
    .join('');

  const resolvedProvider = configuredProviders.some((provider) => provider.id === config.provider)
    ? config.provider
    : configuredProviders[0].id;

  if (resolvedProvider !== config.provider) {
    await updateActiveTranslationConfig({
      provider: resolvedProvider,
      model: getDefaultModelForProvider(resolvedProvider),
      profile: config.profile || DEFAULT_PROFILE
    });
  }

  providerSelect.value = resolvedProvider;
  populateModelSelect(resolvedProvider, resolvedProvider === config.provider ? config.model : getDefaultModelForProvider(resolvedProvider));

  updateTranslationConfigSummary();
}

function populateModelSelect(providerId, selectedModel) {
  const modelSelect = document.getElementById('translationModelSelect');
  if (!modelSelect) {
    return;
  }

  const catalog = PROVIDER_CATALOG[providerId] || PROVIDER_CATALOG.openrouter;
  modelSelect.innerHTML = catalog.models
    .map((model) => `<option value="${model.id}">${model.label}</option>`)
    .join('');

  modelSelect.value = selectedModel && catalog.models.some((model) => model.id === selectedModel)
    ? selectedModel
    : catalog.defaultModel;
}

function updateTranslationConfigSummary() {
  const summaryEl = document.getElementById('providerSummary');
  if (!summaryEl) {
    return;
  }

  const providerSelect = document.getElementById('translationProviderSelect');
  const modelSelect = document.getElementById('translationModelSelect');
  const provider = providerSelect?.value || 'openrouter';
  const model = modelSelect?.value || getDefaultModelForProvider(provider);
  const providerCatalog = PROVIDER_CATALOG[provider] || PROVIDER_CATALOG.openrouter;
  const modelLabel = providerCatalog.models.find((item) => item.id === model)?.label || model;
  const translateSection = document.getElementById('translateSection');
  const hasApiKey = translateSection?.dataset.hasApiKey === 'true';

  if (providerSelect?.disabled) {
    summaryEl.style.display = 'flex';
    summaryEl.innerHTML = [
      '<span class="translation-engine-summary-head">',
      '<span class="translation-engine-summary-label">번역 도움말</span>',
      renderTooltipIcon('구글 번역은 바로 사용할 수 있고, AI 정밀 번역은 설정 탭에서 프로바이더 API Key를 입력한 뒤 사용할 수 있습니다.'),
      '</span>',
      '<span class="translation-engine-inline-note">설정에서 API Key 입력 필요</span>'
    ].join('');
    return;
  }

  const summaryTooltip = [
    `구글 번역은 ${FAST_PAGE_ENGINE_LABEL}(${FAST_PAGE_MODEL})로 API Key 없이 페이지를 빠르게 번역합니다.`,
    `AI 정밀 번역은 ${providerCatalog.label} ${modelLabel}을 사용하며, 제목/인용문/경고문/고유명사 보존을 더 우선합니다.`,
    hasApiKey
      ? '선택 텍스트 번역 엔진은 설정 탭에서 구글 번역 또는 현재 AI provider로 따로 고를 수 있습니다.'
      : '설정 탭에서 프로바이더 API Key를 입력하면 AI 정밀 번역을 쓸 수 있고, 선택 번역은 설정 탭에서 구글 번역/AI 중 고를 수 있습니다.'
  ].join('\n');

  if (hasApiKey) {
    summaryEl.innerHTML = '';
    summaryEl.style.display = 'none';
    return;
  }

  summaryEl.style.display = 'flex';

  summaryEl.innerHTML = [
    '<span class="translation-engine-summary-head">',
    '<span class="translation-engine-summary-label">번역 도움말</span>',
    renderTooltipIcon(summaryTooltip),
    '</span>',
    hasApiKey
      ? ''
      : `<span class="translation-engine-inline-note">${escapeHtml(providerCatalog.label)} API Key 필요</span>`
  ].join('');
}

export function getSupportType(url) {
  try {
    const parsedUrl = new URL(url);
    const denied = parsedUrl.hostname === 'chromewebstore.google.com'
      || (parsedUrl.hostname === 'chrome.google.com' && parsedUrl.pathname.startsWith('/webstore'));

    if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && !denied) {
      return 'requestable';
    }
    if (parsedUrl.protocol === 'file:') {
      return 'file';
    }
    return 'unsupported';
  } catch (_) {
    return 'unsupported';
  }
}

export function initializeTranslationState() {
  setTranslationState(createDefaultTranslationState());
}

export async function handleTabChange(tab) {
  const fromId = currentTabIdValue();
  const currentState = translationStateValue();
  if (currentState.state === 'translating' && tab?.id === fromId) {
    return;
  }

  if (currentState.state === 'translating' && fromId) {
    translationStateByTab.set(fromId, {
      ...currentState,
      batches: [...currentState.batches]
    });
  }

  if (tab?.id) {
    setCurrentTabId(tab.id);
  }

  const activeTabId = currentTabIdValue();
  if (fromId && fromId !== activeTabId && currentState.state !== 'translating') {
    removePortForTab(fromId, { disconnect: true });
  }

  const savedState = activeTabId ? translationStateByTab.get(activeTabId) : null;
  if (savedState && (savedState.state === 'translating' || savedState.state === 'completed' || savedState.state === 'completed_with_errors' || savedState.state === 'restored')) {
    setTranslationState({ ...savedState, batches: [...(savedState.batches || [])] });
  } else {
    initializeTranslationState();
  }

  if (tab) {
    await checkPermissions(tab);
  }

  await refreshTranslationConfigUI({ updateButtons: true });

  const nextState = translationStateValue();
  if (nextState.state === 'translating' && activeTabId && !getPortForTab(activeTabId)) {
    connectToContentScript(activeTabId);
  }

  if (permissionGrantedValue() && activeTabId && !autoTranslateTriggeredByTab.get(activeTabId) && nextState.state === 'inactive') {
    setTimeout(() => {
      void checkAutoTranslate();
    }, 250);
  }
}

async function checkAutoTranslate() {
  const activeTabId = currentTabIdValue();
  if (!activeTabId || !permissionGrantedValue()) {
    return;
  }
  if (autoTranslateTriggeredByTab.get(activeTabId)) {
    return;
  }

  const config = await getActiveTranslationConfig();
  if (!config.autoTranslate) {
    return;
  }

  if (config.profile === 'precise' && !config.hasApiKey) {
    return;
  }

  const hasCached = await checkHasCachedData();
  if (!hasCached) {
    return;
  }

  autoTranslateTriggeredByTab.set(activeTabId, true);
  await handleStartPageTranslation(config.profile || DEFAULT_PROFILE);
}

async function checkHasCachedData() {
  const activeTabId = currentTabIdValue();
  if (!activeTabId) {
    return false;
  }

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { action: ACTIONS.GET_CACHE_STATUS });
    return Boolean(response?.success && response.count > 0);
  } catch (_) {
    return false;
  }
}

function updateUIByPermission() {
  updateUI(permissionGrantedValue());
}

export async function checkPermissions(tab) {
  if (!tab?.url) {
    setPermissionGranted(false);
    return;
  }

  const supportType = getSupportType(tab.url);
  if (supportType === 'unsupported') {
    setPermissionGranted(false);
    return;
  }

  if (supportType === 'file') {
    try {
      const url = new URL(tab.url);
      const origin = `${url.protocol}//${url.host}/*`;
      const hasPermission = await chrome.permissions.contains({ origins: [origin] });
      setPermissionGranted(hasPermission);
    } catch (_) {
      setPermissionGranted(false);
    }
    return;
  }

  setPermissionGranted(true);
  await updatePageCacheStatus();
}

export async function handleRequestPermission() {
  const activeTabId = currentTabIdValue();
  if (!activeTabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(activeTabId);
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });

    if (!granted) {
      showToast('권한이 거부되었습니다.', 'error');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: CONTENT_SCRIPT_FILES
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    await checkPermissions(tab);
    showToast('권한이 허용되었습니다!');
  } catch (error) {
    logError('sidepanel', 'PERMISSION_REQUEST_FAILED', '권한 요청 실패', {}, error);
    showToast('권한 요청 중 오류가 발생했습니다.', 'error');
  }
}

async function ensureContentScriptReady(tabId) {
  const resolveReadyState = async (ping, logMessage) => {
    if (ping?.ok && ping?.version === EXPECTED_CONTENT_RUNTIME_VERSION) {
      await chrome.tabs.sendMessage(tabId, { action: ACTIONS.GET_PROGRESS_V2 });
      logInfo('sidepanel', 'CONTENT_READY_CONFIRMED', 'content script 준비 확인', {
        tabId,
        version: ping.version
      });
      return { status: CONTENT_READY_STATUS.READY };
    }

    if (ping?.ok) {
      logInfo('sidepanel', 'CONTENT_VERSION_MISMATCH', logMessage, {
        tabId,
        expectedVersion: EXPECTED_CONTENT_RUNTIME_VERSION,
        actualVersion: ping?.version || 'unknown'
      });
      return {
        status: CONTENT_READY_STATUS.VERSION_MISMATCH,
        actualVersion: ping?.version || 'unknown'
      };
    }

    return null;
  };

  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
    logInfo('sidepanel', 'CONTENT_PING_RESPONSE', '기존 content script ping 응답 확인', {
      tabId,
      ok: ping?.ok === true,
      version: ping?.version || 'unknown'
    });
    const readyState = await resolveReadyState(ping, '페이지 content script 버전 불일치');
    if (readyState) {
      return readyState;
    }
  } catch (error) {
    logDebug('sidepanel', 'CONTENT_PING_FAILED', '기존 content script ping 실패, 재주입 시도', {
      tabId,
      error: error?.message || '알 수 없음'
    }, error);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES
    });
    await new Promise((resolve) => setTimeout(resolve, 120));

    const ping = await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
    logInfo('sidepanel', 'CONTENT_REINJECT_PING_RESPONSE', 'content script 재주입 후 ping 응답 확인', {
      tabId,
      ok: ping?.ok === true,
      version: ping?.version || 'unknown'
    });
    const readyState = await resolveReadyState(ping, '재주입 후에도 content script 버전 불일치');
    if (readyState) {
      return readyState;
    }

    logInfo('sidepanel', 'CONTENT_READY_MISSING', '재주입 후에도 content script 응답이 준비되지 않음', {
      tabId
    });
    return { status: CONTENT_READY_STATUS.MISSING };
  } catch (error) {
    logError('sidepanel', 'CONTENT_NOT_READY', 'Content script 준비 실패', { tabId }, error);
    return { status: CONTENT_READY_STATUS.MISSING, error };
  }
}

function buildTranslationStartMessage(activeConfig, selectedProfile) {
  return {
    action: selectedProfile === 'precise'
      ? ACTIONS.START_PRECISE_RETRANSLATION
      : ACTIONS.START_PAGE_TRANSLATION,
    provider: activeConfig.provider,
    apiKey: activeConfig.apiKey,
    model: activeConfig.model,
    profile: activeConfig.profile
  };
}

function waitForTabReload(tabId, timeoutMs = CONTENT_RELOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (!finished) {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('TAB_RELOAD_TIMEOUT'));
      }
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finished = true;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sendTranslationStartRequest(tabId, activeConfig, selectedProfile) {
  if (!getPortForTab(tabId)) {
    connectToContentScript(tabId);
  }

  translateModeByTab.set(tabId, selectedProfile === 'precise' ? 'fresh' : 'fast');
  const startMessage = buildTranslationStartMessage(activeConfig, selectedProfile);
  logInfo('sidepanel', 'TRANSLATION_START_REQUEST', '페이지 번역 시작 메시지 전송', {
    tabId,
    action: startMessage.action,
    requestedProfile: selectedProfile,
    configProfile: activeConfig.profile,
    provider: startMessage.provider,
    model: startMessage.model
  });

  const response = await chrome.tabs.sendMessage(tabId, startMessage);
  logInfo('sidepanel', 'TRANSLATION_START_RESPONSE', '페이지 번역 시작 메시지 응답 수신', {
    tabId,
    action: startMessage.action,
    success: response?.success === true
  });

  logInfo('sidepanel', 'TRANSLATION_START', '페이지 번역 시작', {
    tabId,
    provider: selectedProfile === 'precise' ? activeConfig.provider : FAST_PAGE_PROVIDER,
    model: selectedProfile === 'precise' ? activeConfig.model : FAST_PAGE_MODEL,
    profile: selectedProfile
  });
}

async function retryTranslationAfterReload(tabId, activeConfig, selectedProfile) {
  try {
    showToast('확장 업데이트를 적용하는 중입니다. 페이지를 새로고침한 뒤 자동으로 다시 번역합니다.');
    await chrome.tabs.reload(tabId);
    await waitForTabReload(tabId);
    autoTranslateTriggeredByTab.set(tabId, true);

    const readyState = await ensureContentScriptReady(tabId);
    if (readyState.status !== CONTENT_READY_STATUS.READY) {
      return false;
    }

    await sendTranslationStartRequest(tabId, activeConfig, selectedProfile);
    return true;
  } catch (error) {
    logError('sidepanel', 'CONTENT_RELOAD_RETRY_FAILED', 'content script 재시도 실패', {
      tabId,
      profile: selectedProfile
    }, error);
    return false;
  }
}

function connectToContentScript(tabId) {
  try {
    const existing = getPortForTab(tabId);
    if (existing) {
      return;
    }

    const newPort = chrome.tabs.connect(tabId, { name: PORT_NAMES.PANEL });
    setPortForTab(tabId, newPort);

    newPort.onMessage.addListener((msg) => {
      if (msg.type !== PORT_MESSAGES.PROGRESS) {
        return;
      }

      translationStateByTab.set(tabId, { ...msg.data, batches: [...(msg.data.batches || [])] });
      if (tabId === currentTabIdValue()) {
        setTranslationState({ ...msg.data, batches: [...(msg.data.batches || [])] });
        updateUI();
      }

      if (msg.data.state === 'completed') {
        void handleTranslationCompletedForHistory(tabId, msg.data);
      }
    });

    newPort.onDisconnect.addListener(() => {
      removePortForTab(tabId, { disconnect: false });
    });
  } catch (error) {
    logError('sidepanel', 'PORT_CONNECT_ERROR', '포트 연결 실패', { tabId }, error);
  }
}

export async function handleStartPageTranslation(profile = DEFAULT_PROFILE) {
  const activeTabId = currentTabIdValue();
  if (!activeTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  try {
    const tab = await chrome.tabs.get(activeTabId);
    const supportType = getSupportType(tab.url || '');
    logInfo('sidepanel', 'TRANSLATION_START_REQUESTED', '페이지 번역 시작 요청 진입', {
      tabId: activeTabId,
      requestedProfile: profile,
      url: tab.url || '',
      supportType
    });
    await checkPermissions(tab);

    if (supportType === 'unsupported') {
      showToast('이 페이지는 브라우저 정책상 번역을 지원하지 않습니다.', 'error');
      return;
    }
    if (supportType === 'file' && !permissionGrantedValue()) {
      showToast('파일 URL 접근 권한을 허용해야 번역할 수 있습니다.', 'error');
      return;
    }
    if (supportType === 'requestable' && !permissionGrantedValue()) {
      showToast('이 사이트를 번역하려면 접근 권한이 필요합니다.', 'error');
      return;
    }

    const config = await getActiveTranslationConfig();
    const provider = document.getElementById('translationProviderSelect')?.value || config.provider;
    const model = document.getElementById('translationModelSelect')?.value || config.model;
    const selectedProfile = profile || config.profile || DEFAULT_PROFILE;

    await updateActiveTranslationConfig({ provider, model, profile: selectedProfile });
    const activeConfig = await getActiveTranslationConfig();
    logInfo('sidepanel', 'TRANSLATION_CONFIG_RESOLVED', '번역 시작 구성 확정', {
      tabId: activeTabId,
      requestedProfile: selectedProfile,
      provider: activeConfig.provider,
      model: activeConfig.model,
      profile: activeConfig.profile,
      hasApiKey: activeConfig.hasApiKey
    });

    if (selectedProfile === 'precise' && !activeConfig.hasApiKey) {
      showToast('설정 탭에서 프로바이더 API Key를 먼저 입력해주세요.', 'error');
      return;
    }

    const readyState = await ensureContentScriptReady(activeTabId);
    logInfo('sidepanel', 'CONTENT_READY_STATE', '번역 시작 전 content 준비 상태 확인 완료', {
      tabId: activeTabId,
      requestedProfile: selectedProfile,
      status: readyState.status,
      actualVersion: readyState.actualVersion || ''
    });
    if (readyState.status === CONTENT_READY_STATUS.VERSION_MISMATCH) {
      const retried = await retryTranslationAfterReload(activeTabId, activeConfig, selectedProfile);
      if (!retried) {
        showToast('확장 업데이트 적용을 위해 현재 페이지를 한 번 새로고침한 뒤 다시 번역해주세요.', 'error');
      }
      return;
    }

    if (readyState.status !== CONTENT_READY_STATUS.READY) {
      showToast('확장 업데이트 적용을 위해 현재 페이지를 한 번 새로고침한 뒤 다시 번역해주세요.', 'error');
      return;
    }

    await sendTranslationStartRequest(activeTabId, activeConfig, selectedProfile);
  } catch (error) {
    logError('sidepanel', 'TRANSLATION_START_FAILED', '페이지 번역 시작 실패', { tabId: activeTabId }, error);
    showToast(`페이지 번역 시작 중 오류가 발생했습니다: ${error.message}`, 'error');
  }
}

/**
 * 레거시 호출부 호환용 alias
 * @param {boolean} useCache - true면 fast, false면 precise
 */
export async function handleTranslateAll(useCache = true) {
  await handleStartPageTranslation(useCache ? 'fast' : 'precise');
}

export async function handleRestore() {
  const activeTabId = currentTabIdValue();
  if (!activeTabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(activeTabId);
    const supportType = getSupportType(tab.url || '');
    await checkPermissions(tab);

    if (supportType === 'unsupported') {
      showToast('이 페이지는 브라우저 정책상 원문 보기를 지원하지 않습니다.', 'error');
      return;
    }
    if (!permissionGrantedValue()) {
      showToast('이 페이지에 대한 접근 권한이 필요합니다.', 'error');
      return;
    }

    await ensurePageContentScript(activeTabId);

    const currentPort = getPortForTab(activeTabId);
    if (translationStateValue().state === 'translating' && currentPort) {
      currentPort.postMessage({
        type: PORT_MESSAGES.CANCEL_TRANSLATION,
        reason: 'user_restore'
      });
    }

    await chrome.tabs.sendMessage(activeTabId, { action: ACTIONS.RESTORE_PAGE_ORIGINAL });
    resetTranslateUI();
    autoTranslateTriggeredByTab.delete(activeTabId);
  } catch (error) {
    logError('sidepanel', 'RESTORE_ERROR', '원본 복원 실패', { tabId: activeTabId }, error);
    showToast('원본 복원 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
