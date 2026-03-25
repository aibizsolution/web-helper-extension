/**
 * Side Panel UI 유틸리티
 *
 * 역할:
 * - 메인 탭/서브탭 DOM 전환
 * - 세션 복원
 * - 토스트 표시
 * - Content script 준비 확인/주입
 * - 번역 상태 UI 반영
 */

import { logInfo, logDebug, logError, getLogEntries, getLogs } from '../logger.js';
import { ACTIONS } from './constants.js';
import {
  createDefaultTranslationState,
  getCurrentTabId,
  getTranslationState,
  setActivePanelTab,
  setActiveTranslatePanel,
  setTranslationState
} from './state.js';
import {
  CONTENT_SCRIPT_FILES,
  DEFAULT_MAIN_TAB,
  DEFAULT_TRANSLATE_PANEL,
  GITHUB_REPO_URL,
  PANEL_SESSION_KEY,
  PANEL_TITLES
} from './panel-constants.js';
import { syncActivePanels, syncAriaTabButtons } from './panel-dom.js';
import { activateRegisteredTab } from './tab-registry.js';

export function initTranslateSubtabs() {
  const subtabButtons = document.querySelectorAll('[data-translate-panel]');
  subtabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const panelName = button.dataset.translatePanel;
      if (panelName) {
        void switchTranslateSubtab(panelName);
      }
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const panelName = button.dataset.translatePanel;
        if (panelName) {
          void switchTranslateSubtab(panelName);
        }
      }
    });
  });
}

export function initTabbar() {
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      if (tabName) {
        void switchTab(tabName);
      }
    });
    button.addEventListener('keydown', handleTabKeydown);
  });
}

export function initExternalLinks() {
  const githubLinkBtn = document.getElementById('githubLinkBtn');
  if (!githubLinkBtn) {
    return;
  }

  const openGithubRepository = async () => {
    try {
      await chrome.tabs.create({ url: GITHUB_REPO_URL, active: true });
      logInfo('sidepanel', 'GITHUB_REPO_OPENED', 'GitHub 저장소 열기', { url: GITHUB_REPO_URL });
    } catch (error) {
      logError('sidepanel', 'GITHUB_REPO_OPEN_FAILED', 'GitHub 저장소 열기 실패', {
        message: error?.message ?? String(error)
      }, error);
    }
  };

  githubLinkBtn.addEventListener('click', openGithubRepository);
  githubLinkBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      void openGithubRepository();
    }
  });
}

function normalizeTranslatePanel(panelName) {
  if (panelName === 'history') {
    return 'history';
  }

  if (panelName === 'text' || panelName === 'quickTranslate') {
    return 'text';
  }

  return DEFAULT_TRANSLATE_PANEL;
}

function getStoredPanelSessionValue(tabName, translatePanel = DEFAULT_TRANSLATE_PANEL) {
  if (tabName !== 'translate') {
    return tabName || DEFAULT_MAIN_TAB;
  }

  if (translatePanel === 'history') {
    return 'history';
  }

  if (translatePanel === 'text') {
    return 'text';
  }

  return 'translate';
}

function handleTabKeydown(event) {
  const tabButtons = Array.from(document.querySelectorAll('.vertical-tabbar button[role="tab"]'));
  const currentIndex = tabButtons.indexOf(event.target);

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    tabButtons[(currentIndex + 1) % tabButtons.length]?.focus();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    tabButtons[(currentIndex - 1 + tabButtons.length) % tabButtons.length]?.focus();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const tabName = event.target.dataset.tab;
    if (tabName) {
      void switchTab(tabName);
    }
  }
}

async function getCurrentBrowserTab() {
  const currentId = getCurrentTabId();
  if (typeof currentId === 'number') {
    try {
      return await chrome.tabs.get(currentId);
    } catch (_) {
      // fall through
    }
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}

function updateMainTabButtons(activeTabName) {
  const tabButtons = document.querySelectorAll('.vertical-tabbar button[role="tab"]');
  syncAriaTabButtons(tabButtons, (button) => button.dataset.tab === activeTabName);
}

function updateMainTabPanels(activeTabName) {
  const panels = document.querySelectorAll('.tab-content');
  syncActivePanels(panels, (panel) => panel.id === `${activeTabName}Tab`);
}

function updatePanelTitle(activeTabName) {
  const panelTitle = document.getElementById('panelTitle');
  if (panelTitle) {
    panelTitle.textContent = PANEL_TITLES[activeTabName] || PANEL_TITLES[DEFAULT_MAIN_TAB];
  }
}

export async function switchTab(tabName) {
  const requestedTabName = tabName || DEFAULT_MAIN_TAB;
  const normalizedTabName = ['history', 'text', 'quickTranslate', 'page'].includes(requestedTabName)
    ? 'translate'
    : requestedTabName;
  const translatePanel = normalizedTabName === 'translate'
    ? normalizeTranslatePanel(requestedTabName === 'translate' ? getActiveTranslateSubtab() : requestedTabName)
    : getActiveTranslateSubtab();
  const browserTab = await getCurrentBrowserTab();

  updateMainTabButtons(normalizedTabName);
  updateMainTabPanels(normalizedTabName);
  updatePanelTitle(normalizedTabName);

  setActivePanelTab(normalizedTabName);
  await chrome.storage.session.set({
    [PANEL_SESSION_KEY]: getStoredPanelSessionValue(normalizedTabName, translatePanel)
  });

  await activateRegisteredTab(normalizedTabName, {
    browserTab,
    requestedTab: requestedTabName,
    translatePanel: translatePanel || DEFAULT_TRANSLATE_PANEL
  });
}

export function getActiveTranslateSubtab() {
  const activeButton = document.querySelector('[data-translate-panel][aria-selected="true"]');
  return normalizeTranslatePanel(activeButton?.dataset.translatePanel);
}

export async function switchTranslateSubtab(panelName = DEFAULT_TRANSLATE_PANEL) {
  const normalizedPanel = normalizeTranslatePanel(panelName);
  const { updateApiKeyUI, updatePageCacheStatus } = await import('./settings.js');
  const { renderHistoryList } = await import('./history.js');
  const { refreshTranslationConfigUI } = await import('./translation.js');
  const { initQuickTranslateTab } = await import('./quick-translate.js');

  const buttons = document.querySelectorAll('[data-translate-panel]');
  syncAriaTabButtons(buttons, (button) => button.dataset.translatePanel === normalizedPanel);

  const panels = [
    document.getElementById('translatePagePanel'),
    document.getElementById('translateTextPanel'),
    document.getElementById('translateHistoryPanel')
  ].filter(Boolean);
  syncActivePanels(panels, (panel) => panel.id === (
    normalizedPanel === 'history'
      ? 'translateHistoryPanel'
      : normalizedPanel === 'text'
        ? 'translateTextPanel'
        : 'translatePagePanel'
  ));

  setActiveTranslatePanel(normalizedPanel);
  await chrome.storage.session.set({
    [PANEL_SESSION_KEY]: getStoredPanelSessionValue('translate', normalizedPanel)
  });

  if (normalizedPanel === 'history') {
    await renderHistoryList();
    return;
  }

  if (normalizedPanel === 'text') {
    await initQuickTranslateTab();
    return;
  }

  await refreshTranslationConfigUI({ updateButtons: true });
  await updateApiKeyUI();
  await updatePageCacheStatus();
}

export async function restoreSession() {
  try {
    const result = await chrome.storage.session.get(PANEL_SESSION_KEY);
    const lastTab = result[PANEL_SESSION_KEY];
    if (lastTab) {
      await switchTab(lastTab);
      return;
    }

    await switchTab(DEFAULT_MAIN_TAB);
  } catch (error) {
    logError('sidepanel', 'RESTORE_SESSION_FAILED', 'Session 복원 실패', {}, error);
    await switchTab(DEFAULT_MAIN_TAB);
  }
}

export function handleDeepLink() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    void switchTab(hash);
  }
}

export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.className = 'toast show';

  if (type === 'error') {
    toast.classList.add('error');
  }

  window.setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

export async function ensurePageContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
    return;
  } catch (_) {
    // fall through
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPT_FILES
    });
  } catch (error) {
    logDebug('sidepanel', 'ENSURE_CONTENT_SCRIPT_FAILED', 'Content script 준비 실패', {
      tabId,
      error: error?.message || String(error)
    });
  }
}

export function resetTranslateUI() {
  setTranslationState(createDefaultTranslationState());
  updateUI();
}

export function updateUI(hasPermission = true) {
  const currentState = getTranslationState();
  const {
    state,
    phase,
    priority,
    totalSegments,
    visibleSegments,
    translatedSegments,
    cachedCount,
    cacheHits,
    batchCount,
    batchesDone,
    batches,
    activeMs
  } = currentState;

  const statusBadge = document.getElementById('statusBadge');
  const fastBtn = document.getElementById('fastTranslateBtn');
  const preciseBtn = document.getElementById('preciseTranslateBtn');
  const translateSection = document.getElementById('translateSection');
  const hasConfiguredApiKey = translateSection?.dataset.hasApiKey === 'true';
  const activeProfile = currentState.profile === 'precise' ? 'precise' : 'fast';
  const isTranslatedState = ['analyzing', 'translating', 'completed', 'error'].includes(state);
  const fastToggleActive = hasPermission && activeProfile === 'fast' && isTranslatedState;
  const preciseToggleActive = hasPermission && activeProfile === 'precise' && isTranslatedState;

  if (!hasPermission) {
    setStatusBadge(statusBadge, '번역 불가', 'status-badge');
  } else if (state === 'translating' || state === 'analyzing') {
    setStatusBadge(statusBadge, phase === 'visible' ? '우선 표시 완료' : '번역 중', 'status-badge active pulse');
  } else if (state === 'completed') {
    setStatusBadge(statusBadge, '번역 완료', 'status-badge active');
  } else if (state === 'restored') {
    setStatusBadge(statusBadge, '원문 보기', 'status-badge restored');
  } else if (state === 'error') {
    setStatusBadge(statusBadge, '오류', 'status-badge');
  } else {
    setStatusBadge(statusBadge, '대기 중', 'status-badge');
  }

  configureTranslationButton(fastBtn, {
    label: fastToggleActive ? '원본 보기' : '구글 번역',
    title: fastToggleActive
      ? '구글 번역을 멈추고 현재 페이지를 원문으로 되돌립니다.'
      : 'API Key 없이 현재 페이지를 빠르게 읽을 수 있게 번역합니다.',
    disabled: !hasPermission || preciseToggleActive,
    active: fastToggleActive,
    secondary: !fastToggleActive
  });

  configureTranslationButton(preciseBtn, {
    label: preciseToggleActive ? '원본 보기' : 'AI 정밀 번역',
    title: preciseToggleActive
      ? 'AI 정밀 번역을 멈추고 현재 페이지를 원문으로 되돌립니다.'
      : hasConfiguredApiKey
        ? '선택한 프로바이더와 모델로 제목, 인용문, 경고문, 고유명사 보존을 더 우선해 번역합니다.'
        : 'AI 정밀 번역을 쓰려면 현재 프로바이더의 API Key가 필요합니다.',
    disabled: !hasPermission || fastToggleActive || (!hasConfiguredApiKey && !preciseToggleActive),
    active: preciseToggleActive,
    secondary: !preciseToggleActive
  });

  const translatedValue = translatedSegments || currentState.translatedCount || 0;
  const totalValue = totalSegments || currentState.totalTexts || 0;
  const visibleValue = visibleSegments || totalValue;
  const progressTextEl = document.getElementById('progressText');

  if (progressTextEl) {
    if (totalValue > 0) {
      const percent = Math.round((translatedValue / totalValue) * 100);
      progressTextEl.textContent = `우선 표시 ${Math.min(translatedValue, visibleValue)}/${visibleValue} · 전체 ${translatedValue}/${totalValue} (${percent}%)`;
    } else {
      progressTextEl.textContent = '번역 대기 중';
    }
  }

  setText('translatedCount', translatedValue.toLocaleString());
  setText('cachedCount', String((cacheHits || cachedCount || 0).toLocaleString()));
  setText('batchCountText', batchCount > 0 ? `${batchesDone}/${batchCount}` : '0');
  setText('elapsedTime', activeMs > 0 ? formatTime(Math.floor(activeMs / 1000)) : '0s');
  setText('phaseText', formatPhase(phase, priority, visibleValue, totalValue));

  const batchInfoEl = document.getElementById('batchInfo');
  const batchListEl = document.getElementById('batchList');
  if (batchInfoEl && batchListEl) {
    if (Array.isArray(batches) && batches.length > 0) {
      batchInfoEl.style.display = 'block';
      batchListEl.innerHTML = batches.map((batch, index) => `
        <div class="batch-item">
          <span class="batch-name">배치 ${index + 1} (${batch.size || 0}개)</span>
          <span class="batch-status ${batch.status}">${getBatchStatusText(batch.status)}</span>
        </div>
      `).join('');
    } else {
      batchInfoEl.style.display = 'none';
      batchListEl.innerHTML = '';
    }
  }
}

function configureTranslationButton(button, options) {
  if (!button) {
    return;
  }

  button.textContent = options.label;
  button.title = options.title;
  button.disabled = Boolean(options.disabled);
  button.classList.toggle('toggle-active', Boolean(options.active));
  button.classList.toggle('secondary', Boolean(options.secondary));
}

function setStatusBadge(element, text, className) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.className = className;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function formatPhase(phase, priority, visibleSegments, totalSegments) {
  const labels = {
    idle: '대기 중',
    analyzing: '페이지 분석 중',
    visible: `우선순위 ${priority || 1} 표시 완료`,
    full: `전체 번역 진행 중 (${Math.min(visibleSegments, totalSegments)}/${totalSegments || visibleSegments})`,
    completed: '전체 번역 완료'
  };
  return labels[phase] || '대기 중';
}

export function getBatchStatusText(status) {
  const statusMap = {
    pending: '대기',
    processing: '진행',
    completed: '완료',
    failed: '실패'
  };
  return statusMap[status] || status;
}

export function formatTime(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export async function updateErrorLogCount() {
  try {
    const errorLogs = await getLogEntries({ levels: ['ERROR', 'WARN'] });
    const errorBtn = document.getElementById('copyErrorLogsBtn');
    const badgeEl = document.getElementById('errorTabBadge');
    const tabButton = document.querySelector('.vertical-tabbar button[data-tab="errors"]');
    const countLabel = errorLogs.length > 99 ? '99+' : String(errorLogs.length);

    if (badgeEl) {
      badgeEl.hidden = errorLogs.length === 0;
      badgeEl.textContent = countLabel;
    }

    if (tabButton) {
      tabButton.classList.toggle('has-errors', errorLogs.length > 0);
      tabButton.title = errorLogs.length > 0 ? `오류 센터 (${errorLogs.length})` : '오류 센터';
      tabButton.setAttribute(
        'aria-label',
        errorLogs.length > 0
          ? `오류 센터, ${errorLogs.length}개의 오류 또는 경고`
          : '오류 센터'
      );
    }

    if (errorBtn) {
      if (errorLogs.length > 0) {
        errorBtn.textContent = `오류 로그만 복사 (${errorLogs.length})`;
        errorBtn.style.borderColor = '#ef4444';
        errorBtn.style.color = '#ef4444';
      } else {
        errorBtn.textContent = '오류 로그만 복사 (0)';
        errorBtn.style.borderColor = '';
        errorBtn.style.color = '';
      }
    }
  } catch (error) {
    logDebug('sidepanel', 'UPDATE_ERROR_LOG_COUNT_ERROR', '오류 로그 개수 업데이트 실패', {}, error);
  }
}

export async function handleCopyLogs(mode = 'all') {
  try {
    const allLogs = await getLogs();
    if (!allLogs || allLogs.length === 0) {
      showToast('복사할 로그가 없습니다.', 'error');
      return;
    }

    const logsToCopy = mode === 'errors'
      ? (await getLogEntries({ levels: ['ERROR', 'WARN'] })).map((entry) => JSON.stringify(entry))
      : allLogs;

    if (logsToCopy.length === 0) {
      showToast('오류 로그가 없습니다.', 'error');
      return;
    }

    await navigator.clipboard.writeText(logsToCopy.join('\n'));
    showToast(`${logsToCopy.length}개의 로그를 복사했습니다!`);
    await updateErrorLogCount();
  } catch (error) {
    logError('sidepanel', 'LOGS_COPY_ERROR', '로그 복사 실패', {}, error);
    showToast('로그 복사 중 오류가 발생했습니다: ' + error.message, 'error');
  }
}
