/**
 * Side Panel UI 유틸리티
 *
 * 역할:
 * - 탭 전환/세션 복원
 * - 토스트 표시
 * - Content script 준비 확인/주입
 * - 번역 UI 업데이트
 */

import { logInfo, logDebug, logError, getLogs } from '../logger.js';
import { ACTIONS } from './constants.js';
import { currentTabId, translationState } from './state.js';

const SESSION_KEY = 'lastActiveTab';
const GITHUB_REPO_URL = 'https://github.com/park-youngtack/chrome_ext_yt_ai';
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
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });
    btn.addEventListener('keydown', handleTabKeydown);
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
      logError('sidepanel', 'GITHUB_REPO_OPEN_FAILED', 'GitHub 저장소 열기 실패', { message: error?.message ?? String(error) }, error);
    }
  };

  githubLinkBtn.addEventListener('click', openGithubRepository);
  githubLinkBtn.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      openGithubRepository();
    }
  });
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
      switchTab(tabName);
    }
  }
}

export async function switchTab(tabName) {
  const { loadSettings } = await import('./settings.js');
  const { initializeSearchTab } = await import('./search.js');
  const { initQuickTranslateTab } = await import('./quick-translate.js');
  const normalizedTabName = tabName === 'history' ? 'translate' : tabName;
  const translatePanel = tabName === 'history' ? 'history' : getActiveTranslateSubtab();

  document.querySelectorAll('.vertical-tabbar button[role="tab"]').forEach((btn) => {
    btn.setAttribute('aria-selected', btn.dataset.tab === normalizedTabName ? 'true' : 'false');
  });

  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.toggle('active', content.id === `${normalizedTabName}Tab`);
  });

  const titleMap = {
    translate: '웹 도우미',
    quickTranslate: '텍스트 번역',
    geo: 'SEO 검사',
    search: '스마트 검색',
    recurring: '반복 체크리스트',
    settings: '설정'
  };

  const panelTitle = document.getElementById('panelTitle');
  if (panelTitle) {
    panelTitle.textContent = titleMap[normalizedTabName] || '웹 도우미';
  }

  await chrome.storage.session.set({ [SESSION_KEY]: tabName === 'history' ? 'history' : normalizedTabName });

  if (normalizedTabName === 'translate') {
    await switchTranslateSubtab(translatePanel || 'page');
  }

  if (normalizedTabName === 'settings') {
    await loadSettings();
  }

  if (normalizedTabName === 'search') {
    initializeSearchTab();
  }

  if (normalizedTabName === 'quickTranslate') {
    await initQuickTranslateTab();
  }
}

export function getActiveTranslateSubtab() {
  const activeButton = document.querySelector('[data-translate-panel][aria-selected="true"]');
  return activeButton?.dataset.translatePanel || 'page';
}

export async function switchTranslateSubtab(panelName = 'page') {
  const normalizedPanel = panelName === 'history' ? 'history' : 'page';
  const { updateApiKeyUI, updatePageCacheStatus } = await import('./settings.js');
  const { renderHistoryList } = await import('./history.js');

  document.querySelectorAll('[data-translate-panel]').forEach((button) => {
    button.setAttribute('aria-selected', button.dataset.translatePanel === normalizedPanel ? 'true' : 'false');
  });

  const pagePanel = document.getElementById('translatePagePanel');
  const historyPanel = document.getElementById('translateHistoryPanel');

  if (pagePanel) {
    pagePanel.classList.toggle('active', normalizedPanel === 'page');
  }
  if (historyPanel) {
    historyPanel.classList.toggle('active', normalizedPanel === 'history');
  }

  if (normalizedPanel === 'history') {
    await renderHistoryList();
    return;
  }

  await updateApiKeyUI();
  await updatePageCacheStatus();
}

export async function restoreSession() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY);
    const lastTab = result[SESSION_KEY];
    if (lastTab) {
      await switchTab(lastTab);
    }
  } catch (error) {
    logError('sidepanel', 'RESTORE_SESSION_FAILED', 'Session 복원 실패', {}, error);
  }
}

export function handleDeepLink() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    switchTab(hash);
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

  setTimeout(() => {
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
  translationState.state = 'inactive';
  translationState.phase = 'idle';
  translationState.priority = 0;
  translationState.totalSegments = 0;
  translationState.visibleSegments = 0;
  translationState.translatedSegments = 0;
  translationState.totalTexts = 0;
  translationState.translatedCount = 0;
  translationState.cachedCount = 0;
  translationState.cacheHits = 0;
  translationState.batchCount = 0;
  translationState.batchesDone = 0;
  translationState.batches = [];
  translationState.activeRequests = 0;
  translationState.etaMs = 0;
  translationState.activeMs = 0;
  translationState.provider = '';
  translationState.model = '';
  translationState.profile = 'fast';
  translationState.originalTitle = '';
  translationState.translatedTitle = '';
  translationState.previewText = '';

  updateUI();
}

export function updateUI(hasPermission = true) {
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
  } = translationState;

  const statusBadge = document.getElementById('statusBadge');
  const fastBtn = document.getElementById('fastTranslateBtn');
  const preciseBtn = document.getElementById('preciseTranslateBtn');
  const translateSection = document.getElementById('translateSection');
  const hasConfiguredApiKey = translateSection?.dataset.hasApiKey === 'true';
  const activeProfile = translationState.profile === 'precise' ? 'precise' : 'fast';
  const isTranslatedState = state === 'analyzing' || state === 'translating' || state === 'completed' || state === 'error';
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
    label: fastToggleActive ? '원본 보기' : '초고속 번역',
    title: fastToggleActive
      ? '초고속 번역을 멈추고 현재 페이지를 원문으로 되돌립니다.'
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

  const translatedValue = translatedSegments || translationState.translatedCount || 0;
  const totalValue = totalSegments || translationState.totalTexts || 0;
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

function setButtonState(button, disabled) {
  if (button) {
    button.disabled = disabled;
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
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
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
    const allLogs = await getLogs();
    if (!allLogs || allLogs.length === 0) {
      return;
    }

    const errorLogs = allLogs.filter((logLine) => /\["ERROR"\]|\["WARN"\]|"level":"ERROR"|"level":"WARN"/.test(logLine));
    const errorBtn = document.getElementById('copyErrorLogsBtn');
    if (errorBtn) {
      if (errorLogs.length > 0) {
        errorBtn.textContent = `오류 로그만 복사 (${errorLogs.length})`;
        errorBtn.style.borderColor = '#ef4444';
        errorBtn.style.color = '#ef4444';
      } else {
        errorBtn.textContent = '오류 로그만 복사 (0)';
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
      ? allLogs.filter((logLine) => /\["ERROR"\]|\["WARN"\]|"level":"ERROR"|"level":"WARN"/.test(logLine))
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
