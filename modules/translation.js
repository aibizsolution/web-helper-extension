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
  currentTabId,
  translationState,
  translationStateByTab,
  translateModeByTab,
  autoTranslateTriggeredByTab,
  permissionGranted,
  setCurrentTabId,
  setPermissionGranted,
  setTranslationState,
  createDefaultTranslationState,
  getPortForTab,
  setPortForTab,
  removePortForTab
} from './state.js';
import { updateUI, resetTranslateUI, showToast, ensurePageContentScript } from './ui-utils.js';
import { handleTranslationCompletedForHistory } from './history.js';
import { updateApiKeyUI, updatePageCacheStatus } from './settings.js';
import {
  DEFAULT_PROFILE,
  FAST_PAGE_ENGINE_LABEL,
  FAST_PAGE_MODEL,
  FAST_PAGE_PROVIDER,
  PROVIDER_CATALOG,
  getDefaultModelForProvider
} from './provider-catalog.js';
import { getActiveTranslationConfig, getConfiguredProviders, updateActiveTranslationConfig } from './storage.js';

const EXPECTED_CONTENT_RUNTIME_VERSION = '2026-03-12-content-v3';
const CONTENT_SCRIPT_FILES = [
  'content/bootstrap.js',
  'content/api.js',
  'content/provider.js',
  'content/cache.js',
  'content/industry.js',
  'content/dom.js',
  'content/title.js',
  'content/progress.js',
  'content/selection.js',
  'content.js'
];

/**
 * 번역 탭 상단 컨트롤 초기화
 */
export async function initTranslationTab() {
  bindTranslationActionButtons();
  bindTranslationConfigControls();
  await syncTranslationConfigControls();
  await updateApiKeyUI();
  updateTranslationConfigSummary();
}

function bindTranslationActionButtons() {
  document.getElementById('fastTranslateBtn')?.addEventListener('click', () => handleTranslationAction('fast'));
  document.getElementById('preciseTranslateBtn')?.addEventListener('click', () => handleTranslationAction('precise'));
}

function isRestoreToggleState(profile) {
  const currentProfile = translationState.profile === 'precise' ? 'precise' : 'fast';
  if (currentProfile !== profile) {
    return false;
  }

  return ['analyzing', 'translating', 'completed', 'error'].includes(translationState.state);
}

async function handleTranslationAction(profile) {
  if (isRestoreToggleState(profile)) {
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTooltipIcon(text) {
  return `<span class="geo-tooltip-icon translation-tooltip-icon" tabindex="0" role="img" aria-label="${escapeHtml(text)}" data-tooltip="${escapeHtml(text)}">?</span>`;
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
      renderTooltipIcon('초고속 번역은 바로 사용할 수 있고, AI 정밀 번역은 설정 탭에서 프로바이더 API Key를 입력한 뒤 사용할 수 있습니다.'),
      '</span>',
      '<span class="translation-engine-inline-note">설정에서 API Key 입력 필요</span>'
    ].join('');
    return;
  }

  const summaryTooltip = [
    `초고속 번역은 ${FAST_PAGE_ENGINE_LABEL}(${FAST_PAGE_MODEL})로 API Key 없이 페이지를 빠르게 번역합니다.`,
    `AI 정밀 번역은 ${providerCatalog.label} ${modelLabel}을 사용하며, 제목/인용문/경고문/고유명사 보존을 더 우선합니다.`,
    hasApiKey
      ? '선택 텍스트 번역 엔진은 설정 탭에서 초고속 또는 현재 AI provider로 따로 고를 수 있습니다.'
      : '설정 탭에서 프로바이더 API Key를 입력하면 AI 정밀 번역을 쓸 수 있고, 선택 번역은 설정 탭에서 초고속/AI 중 고를 수 있습니다.'
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
  const fromId = currentTabId;
  if (translationState.state === 'translating' && tab?.id === currentTabId) {
    return;
  }

  if (translationState.state === 'translating' && currentTabId) {
    translationStateByTab.set(currentTabId, { ...translationState, batches: [...translationState.batches] });
  }

  if (tab?.id) {
    setCurrentTabId(tab.id);
  }

  if (fromId && fromId !== currentTabId && translationState.state !== 'translating') {
    removePortForTab(fromId, { disconnect: true });
  }

  const savedState = currentTabId ? translationStateByTab.get(currentTabId) : null;
  if (savedState && (savedState.state === 'translating' || savedState.state === 'completed' || savedState.state === 'restored')) {
    setTranslationState({ ...savedState, batches: [...(savedState.batches || [])] });
  } else {
    initializeTranslationState();
  }

  if (tab) {
    await checkPermissions(tab);
  }

  await syncTranslationConfigControls();
  await updateApiKeyUI();
  updateTranslationConfigSummary();
  updateUIByPermission();

  if (translationState.state === 'translating' && currentTabId && !getPortForTab(currentTabId)) {
    connectToContentScript(currentTabId);
  }

  if (permissionGranted && !autoTranslateTriggeredByTab.get(currentTabId) && translationState.state === 'inactive') {
    setTimeout(() => {
      void checkAutoTranslate();
    }, 250);
  }
}

async function checkAutoTranslate() {
  if (!currentTabId || !permissionGranted) {
    return;
  }
  if (autoTranslateTriggeredByTab.get(currentTabId)) {
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

  autoTranslateTriggeredByTab.set(currentTabId, true);
  await handleStartPageTranslation(config.profile || DEFAULT_PROFILE);
}

async function checkHasCachedData() {
  if (!currentTabId) {
    return false;
  }

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { action: ACTIONS.GET_CACHE_STATUS });
    return Boolean(response?.success && response.count > 0);
  } catch (_) {
    return false;
  }
}

function updateUIByPermission() {
  updateUI(permissionGranted);
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
  if (!currentTabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(currentTabId);
    const url = new URL(tab.url);
    const origin = `${url.protocol}//${url.host}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });

    if (!granted) {
      showToast('권한이 거부되었습니다.', 'error');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
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
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
    if (ping?.ok && ping?.version === EXPECTED_CONTENT_RUNTIME_VERSION) {
      await chrome.tabs.sendMessage(tabId, { action: ACTIONS.GET_PROGRESS_V2 });
      return true;
    }

    if (ping?.ok) {
      logInfo('sidepanel', 'CONTENT_VERSION_MISMATCH', '페이지 content script 버전 불일치', {
        tabId,
        expectedVersion: EXPECTED_CONTENT_RUNTIME_VERSION,
        actualVersion: ping?.version || 'unknown'
      });
      return false;
    }
  } catch (_) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPT_FILES
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
      const ping = await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
      if (!ping?.ok || ping?.version !== EXPECTED_CONTENT_RUNTIME_VERSION) {
        logInfo('sidepanel', 'CONTENT_VERSION_MISMATCH', '재주입 후에도 content script 버전 불일치', {
          tabId,
          expectedVersion: EXPECTED_CONTENT_RUNTIME_VERSION,
          actualVersion: ping?.version || 'unknown'
        });
        return false;
      }
      await chrome.tabs.sendMessage(tabId, { action: ACTIONS.GET_PROGRESS_V2 });
      return true;
    } catch (error) {
      logError('sidepanel', 'CONTENT_NOT_READY', 'Content script 준비 실패', { tabId }, error);
      return false;
    }
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
      if (tabId === currentTabId) {
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
  if (!currentTabId) {
    showToast('활성 탭을 찾을 수 없습니다.', 'error');
    return;
  }

  const tab = await chrome.tabs.get(currentTabId);
  const supportType = getSupportType(tab.url || '');
  await checkPermissions(tab);

  if (supportType === 'unsupported') {
    showToast('이 페이지는 브라우저 정책상 번역을 지원하지 않습니다.', 'error');
    return;
  }
  if (supportType === 'file' && !permissionGranted) {
    showToast('파일 URL 접근 권한을 허용해야 번역할 수 있습니다.', 'error');
    return;
  }
  if (supportType === 'requestable' && !permissionGranted) {
    showToast('이 사이트를 번역하려면 접근 권한이 필요합니다.', 'error');
    return;
  }

  const config = await getActiveTranslationConfig();
  const provider = document.getElementById('translationProviderSelect')?.value || config.provider;
  const model = document.getElementById('translationModelSelect')?.value || config.model;
  const selectedProfile = profile || config.profile || DEFAULT_PROFILE;

  await updateActiveTranslationConfig({ provider, model, profile: selectedProfile });
  const activeConfig = await getActiveTranslationConfig();

  if (selectedProfile === 'precise' && !activeConfig.hasApiKey) {
    showToast('설정 탭에서 프로바이더 API Key를 먼저 입력해주세요.', 'error');
    return;
  }

  const isReady = await ensureContentScriptReady(currentTabId);
  if (!isReady) {
    showToast('확장 업데이트 적용을 위해 현재 페이지를 한 번 새로고침한 뒤 다시 번역해주세요.', 'error');
    return;
  }

  if (!getPortForTab(currentTabId)) {
    connectToContentScript(currentTabId);
  }

  translateModeByTab.set(currentTabId, selectedProfile === 'precise' ? 'fresh' : 'fast');

  const action = selectedProfile === 'precise'
    ? ACTIONS.START_PRECISE_RETRANSLATION
    : ACTIONS.START_PAGE_TRANSLATION;

  await chrome.tabs.sendMessage(currentTabId, {
    action,
    provider: activeConfig.provider,
    apiKey: activeConfig.apiKey,
    model: activeConfig.model,
    profile: activeConfig.profile
  });

  logInfo('sidepanel', 'TRANSLATION_START', '페이지 번역 시작', {
    tabId: currentTabId,
    provider: selectedProfile === 'precise' ? activeConfig.provider : FAST_PAGE_PROVIDER,
    model: selectedProfile === 'precise' ? activeConfig.model : FAST_PAGE_MODEL,
    profile: selectedProfile
  });
}

/**
 * 레거시 호출부 호환용 alias
 * @param {boolean} useCache - true면 fast, false면 precise
 */
export async function handleTranslateAll(useCache = true) {
  await handleStartPageTranslation(useCache ? 'fast' : 'precise');
}

export async function handleRestore() {
  if (!currentTabId) {
    return;
  }

  try {
    const tab = await chrome.tabs.get(currentTabId);
    const supportType = getSupportType(tab.url || '');
    await checkPermissions(tab);

    if (supportType === 'unsupported') {
      showToast('이 페이지는 브라우저 정책상 원문 보기를 지원하지 않습니다.', 'error');
      return;
    }
    if (!permissionGranted) {
      showToast('이 페이지에 대한 접근 권한이 필요합니다.', 'error');
      return;
    }

    await ensurePageContentScript(currentTabId);

    const currentPort = getPortForTab(currentTabId);
    if (translationState.state === 'translating' && currentPort) {
      currentPort.postMessage({
        type: PORT_MESSAGES.CANCEL_TRANSLATION,
        reason: 'user_restore'
      });
    }

    await chrome.tabs.sendMessage(currentTabId, { action: ACTIONS.RESTORE_PAGE_ORIGINAL });
    resetTranslateUI();
    autoTranslateTriggeredByTab.delete(currentTabId);
  } catch (error) {
    logError('sidepanel', 'RESTORE_ERROR', '원본 복원 실패', { tabId: currentTabId }, error);
    showToast('원본 복원 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
