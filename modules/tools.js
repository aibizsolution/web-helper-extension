/**
 * Side Panel 도구 탭 로직
 *
 * 역할:
 * - 브라우저 캐시/사이트 데이터 정리
 * - 기간별 방문 TOP 집계 및 새 탭 열기
 */

import { logInfo, logDebug, logError } from '../logger.js';
import { getCurrentTabId } from './state.js';
import { showToast } from './ui-utils.js';
import { escapeHtml } from './panel-dom.js';

const TOOL_RANGES = [
  { key: '15m', label: '15분', minutes: 15 },
  { key: '1h', label: '1시간', minutes: 60 },
  { key: '24h', label: '24시간', minutes: 60 * 24 },
  { key: '7d', label: '7일', minutes: 60 * 24 * 7 },
  { key: 'all', label: '전체', minutes: null }
];

const CLEANUP_ACTIONS = {
  globalCache: {
    key: 'globalCache',
    label: '전체 브라우저 캐시 삭제',
    needsSite: false,
    dataToRemove: { cache: true }
  },
  siteCache: {
    key: 'siteCache',
    label: '현재 사이트 캐시 삭제',
    needsSite: true,
    dataToRemove: { cache: true }
  },
  siteStorage: {
    key: 'siteStorage',
    label: '현재 사이트 데이터 삭제',
    needsSite: true,
    dataToRemove: {
      cookies: true,
      cacheStorage: true,
      indexedDB: true,
      localStorage: true,
      serviceWorkers: true,
      fileSystems: true
    }
  }
};

const HISTORY_SEARCH_LIMITS = {
  '15m': 600,
  '1h': 1200,
  '24h': 3000,
  '7d': 6000,
  all: 10000
};

const VISIT_FETCH_CONCURRENCY = 10;
const VISIT_GROUP_LIMIT = 100;
const CLEANUP_CONFIRM_RESET_MS = 4500;
const LEGACY_UNSUPPORTED_BROWSING_DATA_TYPES = new Set(['webSQL']);
const DEFAULT_TOOL_RANGE = '24h';
const VISIT_TOP_LABEL = `방문 TOP ${VISIT_GROUP_LIMIT}`;

let initialized = false;
let visitRange = DEFAULT_TOOL_RANGE;
let activeToolsPanel = 'cleanup';
let pendingCleanupAction = '';
let cleanupExecutingAction = '';
let cleanupConfirmTimer = null;
let historyRequestToken = 0;
let activeSiteContext = createEmptySiteContext();
let cleanupRangeByAction = createCleanupRangeState();

function createEmptySiteContext() {
  return {
    tabId: null,
    url: '',
    origin: '',
    hostname: '',
    displayLabel: '확인 중',
    supported: false,
    reason: '현재 웹페이지를 확인하는 중입니다.'
  };
}

function createCleanupRangeState() {
  return Object.values(CLEANUP_ACTIONS).reduce((accumulator, action) => {
    accumulator[action.key] = DEFAULT_TOOL_RANGE;
    return accumulator;
  }, {});
}

function getRangeOption(rangeKey = DEFAULT_TOOL_RANGE) {
  return TOOL_RANGES.find((option) => option.key === rangeKey) || TOOL_RANGES[2];
}

function getRangeSince(rangeKey = DEFAULT_TOOL_RANGE) {
  const option = getRangeOption(rangeKey);
  if (option.minutes === null) {
    return 0;
  }
  return Date.now() - (option.minutes * 60 * 1000);
}

function getHistorySearchLimit(rangeKey = DEFAULT_TOOL_RANGE) {
  return HISTORY_SEARCH_LIMITS[rangeKey] || HISTORY_SEARCH_LIMITS.all;
}

function isToolsTabActive() {
  return Boolean(document.getElementById('toolsTab')?.classList.contains('active'));
}

function isVisitPanelActive() {
  return activeToolsPanel === 'visits';
}

function normalizeHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('www.') && normalized.split('.').length >= 3) {
    return normalized.slice(4);
  }
  return normalized;
}

function clearCleanupConfirmTimer() {
  if (cleanupConfirmTimer) {
    clearTimeout(cleanupConfirmTimer);
    cleanupConfirmTimer = null;
  }
}

function resetPendingCleanupAction() {
  pendingCleanupAction = '';
  clearCleanupConfirmTimer();
  renderCleanupActionState();
}

function scheduleCleanupConfirmReset() {
  clearCleanupConfirmTimer();
  cleanupConfirmTimer = window.setTimeout(() => {
    pendingCleanupAction = '';
    cleanupConfirmTimer = null;
    renderCleanupActionState();
  }, CLEANUP_CONFIRM_RESET_MS);
}

function formatRangeLabel(rangeKey = DEFAULT_TOOL_RANGE) {
  const option = getRangeOption(rangeKey);
  return option.minutes === null ? '전체 기간' : `지난 ${option.label}`;
}

function formatRelativeTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) {
    return '시간 정보 없음';
  }

  const diffMs = Date.now() - value;
  if (diffMs < 60 * 1000) {
    return '방금 전';
  }

  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}일 전`;
}

function buildRemovableDataTypeSet(dataToRemove = {}) {
  return Object.entries(dataToRemove).reduce((accumulator, [key, enabled]) => {
    if (enabled && !LEGACY_UNSUPPORTED_BROWSING_DATA_TYPES.has(key)) {
      accumulator[key] = true;
    }
    return accumulator;
  }, {});
}

function omitRemovalDataTypes(dataToRemove = {}, unsupportedTypes = []) {
  const omitSet = new Set(
    (unsupportedTypes || [])
      .map((type) => String(type || '').trim())
      .filter(Boolean)
  );

  return Object.entries(dataToRemove).reduce((accumulator, [key, enabled]) => {
    if (enabled && !omitSet.has(key)) {
      accumulator[key] = true;
    }
    return accumulator;
  }, {});
}

function parseUnsupportedDataTypes(error) {
  const message = String(error?.message || '');
  const matched = message.match(/Requested data type\(s\) are not supported:\s*(.+)$/i);
  if (!matched || !matched[1]) {
    return [];
  }

  return matched[1]
    .split(',')
    .map((value) => value.replace(/[.;]+$/g, '').trim())
    .filter(Boolean);
}

async function removeBrowsingDataSafely(removalOptions, dataToRemove) {
  const initialDataTypes = buildRemovableDataTypeSet(dataToRemove);
  if (Object.keys(initialDataTypes).length === 0) {
    throw new Error('삭제할 수 있는 사이트 데이터 항목이 없습니다.');
  }

  try {
    await chrome.browsingData.remove(removalOptions, initialDataTypes);
    return initialDataTypes;
  } catch (error) {
    const unsupportedTypes = parseUnsupportedDataTypes(error);
    if (unsupportedTypes.length === 0) {
      throw error;
    }

    const fallbackDataTypes = omitRemovalDataTypes(initialDataTypes, unsupportedTypes);
    if (Object.keys(fallbackDataTypes).length === 0) {
      throw error;
    }

    logDebug('tools', 'BROWSING_DATA_RETRY_WITH_SUPPORTED_TYPES', '지원되지 않는 데이터 타입을 제외하고 다시 시도합니다.', {
      unsupportedTypes
    });

    await chrome.browsingData.remove(removalOptions, fallbackDataTypes);
    return fallbackDataTypes;
  }
}

function renderVisitRangeState() {
  document.querySelectorAll('[data-tools-range]').forEach((button) => {
    const isSelected = button.dataset.toolsRange === visitRange;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  const summaryEl = document.getElementById('toolsRangeSummary');
  if (summaryEl) {
    summaryEl.textContent = `${formatRangeLabel(visitRange)} 기준`;
  }

  const visitSummaryEl = document.getElementById('toolsVisitSummary');
  if (visitSummaryEl) {
    visitSummaryEl.textContent = `${formatRangeLabel(visitRange)} 기준 ${VISIT_TOP_LABEL}`;
  }
}

function renderToolsPanelState() {
  document.querySelectorAll('[data-tools-panel]').forEach((button) => {
    const isActive = button.dataset.toolsPanel === activeToolsPanel;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('[data-tools-panel-content]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.toolsPanelContent === activeToolsPanel);
  });
}

function renderSiteContext() {
  const siteValueEl = document.getElementById('toolsCurrentSiteValue');
  const cleanupMetaEl = document.getElementById('toolsCleanupMeta');

  if (siteValueEl) {
    siteValueEl.textContent = activeSiteContext.displayLabel;
    siteValueEl.classList.toggle('is-disabled', !activeSiteContext.supported);
  }

  if (cleanupMetaEl) {
    cleanupMetaEl.textContent = activeSiteContext.supported
      ? '현재 사이트 데이터 삭제 시 로그인이 풀릴 수 있습니다.'
      : activeSiteContext.reason;
    cleanupMetaEl.classList.toggle('is-disabled', !activeSiteContext.supported);
  }
}

function renderCleanupActionState() {
  Object.values(CLEANUP_ACTIONS).forEach((action) => {
    const button = document.querySelector(`[data-cleanup-action="${action.key}"]`);
    const row = document.querySelector(`[data-cleanup-row="${action.key}"]`);
    const rangeSelect = document.querySelector(`[data-cleanup-range="${action.key}"]`);
    if (!button) {
      return;
    }

    const needsSite = action.needsSite === true;
    const isBusy = cleanupExecutingAction === action.key;
    const isConfirming = pendingCleanupAction === action.key;
    const isDisabled = Boolean(cleanupExecutingAction)
      || (needsSite && !activeSiteContext.supported);
    const labelEl = button.querySelector('[data-role="cleanup-label"]');

    button.disabled = isDisabled;
    button.classList.toggle('is-confirming', isConfirming);
    button.classList.toggle('is-disabled', isDisabled);
    button.classList.toggle('is-busy', isBusy);
    row?.classList.toggle('is-confirming', isConfirming);
    row?.classList.toggle('is-disabled', isDisabled);

    if (rangeSelect) {
      rangeSelect.value = cleanupRangeByAction[action.key] || DEFAULT_TOOL_RANGE;
      rangeSelect.disabled = isDisabled;
    }

    if (labelEl) {
      labelEl.textContent = isBusy
        ? '정리 중...'
        : isConfirming
          ? '삭제 확인'
          : '삭제';
    }
  });
}

function renderVisitState(options = {}) {
  const listEl = document.getElementById('toolsVisitList');
  const emptyEl = document.getElementById('toolsVisitEmpty');
  const loadingEl = document.getElementById('toolsVisitLoading');
  const loading = options.loading === true;
  const message = options.message || '';

  if (loadingEl) {
    loadingEl.style.display = loading ? 'flex' : 'none';
  }

  if (listEl) {
    listEl.style.display = loading || message ? 'none' : 'flex';
  }

  if (emptyEl) {
    emptyEl.style.display = loading ? 'none' : 'flex';
    if (message) {
      emptyEl.textContent = message;
    }
  }
}

async function getActiveTabContext(tabOverride) {
  let tab = tabOverride || null;
  const currentTabId = getCurrentTabId();

  if (!tab && typeof currentTabId === 'number') {
    try {
      tab = await chrome.tabs.get(currentTabId);
    } catch (_) {
      tab = null;
    }
  }

  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs && tabs[0] ? tabs[0] : null;
  }

  if (!tab || !tab.url) {
    return {
      tabId: tab?.id ?? null,
      url: '',
      origin: '',
      hostname: '',
      displayLabel: '현재 사이트 없음',
      supported: false,
      reason: '현재 웹페이지를 확인할 수 없습니다.'
    };
  }

  try {
    const parsedUrl = new URL(tab.url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        tabId: tab.id,
        url: tab.url,
        origin: '',
        hostname: '',
        displayLabel: '지원되지 않는 페이지',
        supported: false,
        reason: 'http/https 페이지에서만 사이트 정리를 지원합니다.'
      };
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    return {
      tabId: tab.id,
      url: tab.url,
      origin: parsedUrl.origin,
      hostname,
      displayLabel: hostname || parsedUrl.hostname,
      supported: true,
      reason: ''
    };
  } catch (_) {
    return {
      tabId: tab.id,
      url: tab.url,
      origin: '',
      hostname: '',
      displayLabel: '지원되지 않는 페이지',
      supported: false,
      reason: '현재 사이트 주소를 해석할 수 없습니다.'
    };
  }
}

async function refreshSiteContext(tabOverride) {
  activeSiteContext = await getActiveTabContext(tabOverride);
  renderSiteContext();
  renderCleanupActionState();
}

function bindRangeButtons() {
  document.querySelectorAll('[data-tools-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextRange = button.dataset.toolsRange;
      if (!nextRange || nextRange === visitRange) {
        return;
      }
      visitRange = nextRange;
      renderVisitRangeState();
      if (isToolsTabActive() && isVisitPanelActive()) {
        void refreshVisitGroups();
      }
    });
  });
}

function bindCleanupRangeControls() {
  document.querySelectorAll('[data-cleanup-range]').forEach((select) => {
    select.addEventListener('change', () => {
      const actionKey = select.dataset.cleanupRange;
      if (!actionKey) {
        return;
      }

      cleanupRangeByAction[actionKey] = select.value || DEFAULT_TOOL_RANGE;
      resetPendingCleanupAction();
      renderCleanupActionState();
    });
  });
}

function bindPanelTabs() {
  document.querySelectorAll('[data-tools-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPanel = button.dataset.toolsPanel;
      if (!nextPanel || nextPanel === activeToolsPanel) {
        return;
      }

      activeToolsPanel = nextPanel;
      renderToolsPanelState();

      if (isToolsTabActive() && isVisitPanelActive()) {
        void refreshVisitGroups();
      }
    });
  });
}

function bindCleanupButtons() {
  document.querySelectorAll('[data-cleanup-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const actionKey = button.dataset.cleanupAction;
      const action = CLEANUP_ACTIONS[actionKey];
      if (!action || button.disabled) {
        return;
      }

      if (pendingCleanupAction !== action.key) {
        pendingCleanupAction = action.key;
        scheduleCleanupConfirmReset();
        renderCleanupActionState();
        return;
      }

      resetPendingCleanupAction();
      await runCleanupAction(action);
    });
  });
}

function bindVisitList() {
  const listEl = document.getElementById('toolsVisitList');
  if (!listEl) {
    return;
  }

  listEl.addEventListener('click', async (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest('[data-visit-url]')
      : null;
    if (!trigger) {
      return;
    }

    const url = trigger.getAttribute('data-visit-url') || '';
    const siteLabel = trigger.getAttribute('data-site-label') || '사이트';
    if (!url) {
      return;
    }

    try {
      await chrome.tabs.create({ url, active: true });
      showToast(`${siteLabel} 대표 페이지를 새 탭에서 열었습니다.`);
      logInfo('tools', 'VISIT_TOP_OPENED', '방문 TOP 링크 열기', { url, siteLabel });
    } catch (error) {
      logError('tools', 'VISIT_TOP_OPEN_FAILED', '방문 TOP 링크 열기 실패', { url }, error);
      showToast('링크를 새 탭으로 열지 못했습니다.', 'error');
    }
  });
}

async function runCleanupAction(action) {
  try {
    cleanupExecutingAction = action.key;
    renderCleanupActionState();
    const actionRange = cleanupRangeByAction[action.key] || DEFAULT_TOOL_RANGE;

    const removalOptions = {
      since: getRangeSince(actionRange)
    };

    if (action.needsSite) {
      if (!activeSiteContext.supported || !activeSiteContext.origin) {
        throw new Error('현재 사이트 정리를 지원하지 않는 페이지입니다.');
      }
      removalOptions.origins = [activeSiteContext.origin];
    }

    await removeBrowsingDataSafely(removalOptions, action.dataToRemove);

    if (action.key === CLEANUP_ACTIONS.globalCache.key) {
      showToast(`${formatRangeLabel(actionRange)} 브라우저 캐시를 삭제했습니다.`);
    } else if (action.key === CLEANUP_ACTIONS.siteCache.key) {
      showToast(`${formatRangeLabel(actionRange)} 기준 ${activeSiteContext.displayLabel} 캐시를 삭제했습니다.`);
    } else {
      showToast(`${formatRangeLabel(actionRange)} 기준 ${activeSiteContext.displayLabel} 사이트 데이터를 삭제했습니다.`);
    }

    logInfo('tools', 'BROWSING_DATA_CLEARED', '브라우저 데이터 정리 완료', {
      action: action.key,
      range: actionRange,
      origin: activeSiteContext.origin || null
    });
  } catch (error) {
    logError('tools', 'BROWSING_DATA_CLEAR_FAILED', '브라우저 데이터 정리 실패', {
      action: action.key,
      range: cleanupRangeByAction[action.key] || DEFAULT_TOOL_RANGE,
      origin: activeSiteContext.origin || null
    }, error);
    showToast(error?.message || '브라우저 데이터 정리 중 오류가 발생했습니다.', 'error');
  } finally {
    cleanupExecutingAction = '';
    renderCleanupActionState();
  }
}

function createHistoryQuery(rangeKey) {
  return {
    text: '',
    startTime: getRangeSince(rangeKey),
    maxResults: getHistorySearchLimit(rangeKey)
  };
}

function normalizeHistoryItem(item) {
  if (!item || !item.url) {
    return null;
  }

  try {
    const parsedUrl = new URL(item.url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return null;
    }

    const hostname = normalizeHostname(parsedUrl.hostname);
    if (!hostname) {
      return null;
    }

    return {
      url: item.url,
      title: item.title || hostname,
      hostname,
      lastVisitTime: Number(item.lastVisitTime) || 0,
      visitCount: Number(item.visitCount) || 0
    };
  } catch (_) {
    return null;
  }
}

async function mapWithConcurrency(items, worker, limit) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (_) {
        results[currentIndex] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function annotateHistoryItems(historyItems, rangeKey, requestToken) {
  const normalizedItems = historyItems
    .map((item) => normalizeHistoryItem(item))
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    return [];
  }

  if (rangeKey === 'all') {
    return normalizedItems
      .map((item) => ({
        ...item,
        rangeVisitCount: Math.max(1, item.visitCount || 0)
      }))
      .filter((item) => item.rangeVisitCount > 0);
  }

  const since = getRangeSince(rangeKey);
  const now = Date.now();

  return (await mapWithConcurrency(normalizedItems, async (item) => {
    if (requestToken !== historyRequestToken) {
      return null;
    }

    const visits = await chrome.history.getVisits({ url: item.url });
    const rangeVisitCount = (visits || []).filter((visit) => {
      const visitTime = Number(visit.visitTime) || 0;
      return visitTime >= since && visitTime <= now;
    }).length;

    if (rangeVisitCount <= 0) {
      return null;
    }

    return {
      ...item,
      rangeVisitCount
    };
  }, VISIT_FETCH_CONCURRENCY))
    .filter(Boolean);
}

function buildVisitGroups(items) {
  const grouped = new Map();

  items.forEach((item) => {
    const existing = grouped.get(item.hostname) || {
      siteLabel: item.hostname,
      totalVisits: 0,
      lastVisitTime: 0,
      topPageUrl: item.url,
      topPageTitle: item.title || item.hostname,
      topPageVisits: 0,
      topPageLastVisitTime: 0,
      pageCount: 0
    };

    existing.totalVisits += item.rangeVisitCount;
    existing.lastVisitTime = Math.max(existing.lastVisitTime, item.lastVisitTime);
    existing.pageCount += 1;

    if (
      item.rangeVisitCount > existing.topPageVisits
      || (item.rangeVisitCount === existing.topPageVisits && item.lastVisitTime > existing.topPageLastVisitTime)
    ) {
      existing.topPageUrl = item.url;
      existing.topPageTitle = item.title || item.hostname;
      existing.topPageVisits = item.rangeVisitCount;
      existing.topPageLastVisitTime = item.lastVisitTime;
    }

    grouped.set(item.hostname, existing);
  });

  return Array.from(grouped.values())
    .sort((a, b) => {
      if (b.totalVisits !== a.totalVisits) {
        return b.totalVisits - a.totalVisits;
      }
      return b.lastVisitTime - a.lastVisitTime;
    })
    .slice(0, VISIT_GROUP_LIMIT);
}

function renderVisitGroups(groups) {
  const listEl = document.getElementById('toolsVisitList');
  const emptyEl = document.getElementById('toolsVisitEmpty');
  const loadingEl = document.getElementById('toolsVisitLoading');
  const summaryEl = document.getElementById('toolsVisitMeta');

  if (loadingEl) {
    loadingEl.style.display = 'none';
  }

  if (summaryEl) {
    summaryEl.textContent = groups.length > 0
      ? `${groups.length}개 사이트`
      : '0개 사이트';
  }

  if (!listEl || groups.length === 0) {
    if (listEl) {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
    }
    if (emptyEl) {
      emptyEl.style.display = 'flex';
      emptyEl.textContent = `${formatRangeLabel(visitRange)} 기준 방문 기록이 없습니다.`;
    }
    return;
  }

  listEl.innerHTML = groups.map((group, index) => `
    <button type="button" class="tools-visit-item" data-visit-url="${escapeHtml(group.topPageUrl)}" data-site-label="${escapeHtml(group.siteLabel)}">
      <div class="tools-visit-rank">${index + 1}</div>
      <div class="tools-visit-body">
        <div class="tools-visit-head">
          <div class="tools-visit-site">${escapeHtml(group.siteLabel)}</div>
          <div class="tools-visit-count">방문 ${group.totalVisits}회</div>
        </div>
        <div class="tools-visit-title">${escapeHtml(group.topPageTitle)}</div>
        <div class="tools-visit-meta-row">
          <span>최근 ${formatRelativeTime(group.lastVisitTime)}</span>
          <span>페이지 ${group.pageCount}개</span>
          <span>새 탭 열기</span>
        </div>
      </div>
    </button>
  `).join('');

  listEl.style.display = 'flex';
  if (emptyEl) {
    emptyEl.style.display = 'none';
  }
}

async function refreshVisitGroups() {
  const listEl = document.getElementById('toolsVisitList');
  if (!listEl) {
    return;
  }

  const requestToken = historyRequestToken + 1;
  historyRequestToken = requestToken;
  renderVisitState({ loading: true });

  try {
    const historyItems = await chrome.history.search(createHistoryQuery(visitRange));
    if (requestToken !== historyRequestToken) {
      return;
    }

    const annotatedItems = await annotateHistoryItems(historyItems || [], visitRange, requestToken);
    if (requestToken !== historyRequestToken) {
      return;
    }

    renderVisitGroups(buildVisitGroups(annotatedItems));
    logDebug('tools', 'VISIT_TOP_REFRESHED', '방문 TOP 새로고침 완료', {
      range: visitRange,
      itemCount: annotatedItems.length
    });
  } catch (error) {
    logError('tools', 'VISIT_TOP_REFRESH_FAILED', '방문 TOP 새로고침 실패', { range: visitRange }, error);
    renderVisitState({ loading: false, message: `${VISIT_TOP_LABEL}을 불러오지 못했습니다.` });
  }
}

export async function refreshToolsTab(options = {}) {
  if (!initialized) {
    initToolsTab();
  }

  await refreshSiteContext(options.tab || null);
  renderToolsPanelState();
  renderVisitRangeState();
  renderCleanupActionState();

  if (options.refreshVisits !== false && isVisitPanelActive()) {
    await refreshVisitGroups();
  }
}

export async function handleToolsTabContextChange(tab) {
  if (!initialized) {
    return;
  }

  await refreshSiteContext(tab || null);
  if (isToolsTabActive() && isVisitPanelActive()) {
    await refreshVisitGroups();
  }
}

export function initToolsTab() {
  if (initialized) {
    renderVisitRangeState();
    renderSiteContext();
    renderCleanupActionState();
    return;
  }

  initialized = true;
  bindPanelTabs();
  bindRangeButtons();
  bindCleanupRangeControls();
  bindCleanupButtons();
  bindVisitList();
  renderToolsPanelState();
  renderVisitRangeState();
  renderSiteContext();
  renderCleanupActionState();
  renderVisitState({ loading: false, message: `${formatRangeLabel(visitRange)} 기준 방문 기록을 확인할 수 있습니다.` });
}
