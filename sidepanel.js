/**
 * Side Panel Script - 메인 진입점
 *
 * 역할:
 * - 패널 공통 초기화
 * - 탭 레지스트리 연결
 * - 현재 활성 브라우저 탭 컨텍스트 동기화
 */

import { FOOTER_TEXT } from './meta.js';
import { logInfo, logError, initLogger } from './logger.js';
import {
  autoTranslateTriggeredByTab,
  createDefaultTranslationState,
  getCurrentTabId,
  removePortForTab,
  setCurrentTabId,
  setTranslationState,
  translationStateByTab,
  translateModeByTab
} from './modules/state.js';
import {
  handleDeepLink,
  initExternalLinks,
  initTabbar,
  initTranslateSubtabs,
  restoreSession,
  showToast,
  switchTab,
  updateErrorLogCount,
  updateUI
} from './modules/ui-utils.js';
import { getSupportType, handleRequestPermission } from './modules/translation.js';
import { handleClearPageCache } from './modules/settings.js';
import { initTooltipHandlers } from './modules/geo-ui.js';
import { createPanelTabModules } from './modules/panel-tab-modules.js';
import { initializeRegisteredTabs, notifyActiveBrowserTabChanged, registerTab } from './modules/tab-registry.js';

function hydrateTranslationStateForTab(tabId) {
  const savedState = translationStateByTab.get(tabId);
  if (savedState && (savedState.state === 'translating' || savedState.state === 'completed')) {
    setTranslationState({
      ...savedState,
      batches: Array.isArray(savedState.batches) ? [...savedState.batches] : []
    });
    return;
  }

  setTranslationState(createDefaultTranslationState());
}

function reflectSupportState(tab) {
  const type = getSupportType(tab?.url || '');
  if (type === 'unsupported') {
    updateUI(false);
    return;
  }

  updateUI();
}

async function syncActiveBrowserTab(tab) {
  if (!tab?.id) {
    return;
  }

  setCurrentTabId(tab.id);
  hydrateTranslationStateForTab(tab.id);
  reflectSupportState(tab);
  await notifyActiveBrowserTabChanged(tab);
}

function bindStaticButtons() {
  document.getElementById('requestPermissionBtn')?.addEventListener('click', () => {
    void handleRequestPermission();
  });

  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    void switchTab('settings');
  });

  document.getElementById('goToSettingsBtn')?.addEventListener('click', () => {
    void switchTab('settings');
  });

  document.getElementById('clearPageCacheBtn')?.addEventListener('click', () => {
    void handleClearPageCache();
  });
}

async function registerPanelTabs() {
  const tabModules = createPanelTabModules();
  Object.entries(tabModules).forEach(([tabName, module]) => {
    registerTab(tabName, module);
  });

  await initializeRegisteredTabs(document);
}

document.addEventListener('DOMContentLoaded', async () => {
  window.__WPT_PANEL_BINDINGS_READY = false;
  window.__WPT_PANEL_READY = false;

  try {
    const footerEl = document.getElementById('footerText');
    if (footerEl) {
      footerEl.textContent = FOOTER_TEXT;
    }

    // UI 이벤트는 가장 먼저 묶어서 첫 클릭 유실을 막습니다.
    initTabbar();
    initTranslateSubtabs();
    initExternalLinks();
    initTooltipHandlers();
    bindStaticButtons();
    window.__WPT_PANEL_BINDINGS_READY = true;

    await initLogger();
    await registerPanelTabs();

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await syncActiveBrowserTab(tab);
    }

    await updateErrorLogCount();
    await restoreSession();
    handleDeepLink();
    window.__WPT_PANEL_READY = true;

    logInfo('sidepanel', 'INIT', '사이드패널 초기화 완료');
  } catch (error) {
    window.__WPT_PANEL_BINDINGS_READY = false;
    window.__WPT_PANEL_READY = false;
    logError('sidepanel', 'INIT_ERROR', '초기화 중 오류', {}, error);
    showToast('사이드패널 초기화 중 오류가 발생했습니다.', 'error');
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab) {
      await syncActiveBrowserTab(tab);
    }
  } catch (error) {
    logError('sidepanel', 'TAB_ACTIVATED_ERROR', '탭 활성화 처리 중 오류', {}, error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (getCurrentTabId() === tabId && changeInfo.status === 'complete') {
    translationStateByTab.delete(tabId);
    autoTranslateTriggeredByTab.delete(tabId);
    await syncActiveBrowserTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  translationStateByTab.delete(tabId);
  translateModeByTab.delete(tabId);
  autoTranslateTriggeredByTab.delete(tabId);

  try {
    removePortForTab(tabId, { disconnect: true });
  } catch (_) {
    // noop
  }
});
