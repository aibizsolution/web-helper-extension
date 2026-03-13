/**
 * Background Service Worker
 *
 * 역할:
 * - Content script 등록/주입
 * - 선택 텍스트 우클릭 메뉴
 * - 사이드패널 열기 브리지
 * - 전체 캐시 상태 조회
 */

import { ACTIONS, SELECTION_ACTIONS, SELECTION_CONTEXT_MENU_ROOT_ID, STORAGE_KEYS } from './modules/constants.js';
import { CONTENT_SCRIPT_FILES, PANEL_SESSION_KEY } from './modules/panel-constants.js';

const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLogLevel = 'INFO';

const FAST_TRANSLATE_TARGET_LANGUAGE = 'ko';
const SIDE_PANEL_COMMAND_ID = 'open-side-panel';
const openSidePanelWindows = new Set();

const selectionActionByMenuId = new Map(
  SELECTION_ACTIONS.map((action) => [action.contextMenuId, action])
);

(async () => {
  try {
    const result = await chrome.storage.local.get(['debugLog']);
    currentLogLevel = result.debugLog ? 'DEBUG' : 'INFO';
  } catch (_) {
    currentLogLevel = 'INFO';
  }
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.debugLog) {
    currentLogLevel = changes.debugLog.newValue ? 'DEBUG' : 'INFO';
  }
});

function log(level, evt, msg = '', data = {}, err = null) {
  if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) {
    return;
  }

  const record = { ts: new Date().toISOString(), level, ns: 'background', evt, msg, ...data };
  if (err) {
    record.err = err instanceof Error ? err.message : String(err);
  }

  const prefix = `[WPT][${level}][background]`;
  const method = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
  console[method]('%s %s %o', prefix, evt, record);
}

const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

chrome.runtime.onInstalled.addListener(async () => {
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  await registerContentScripts();
  await registerContextMenus();
});

if (chrome.sidePanel?.onOpened) {
  chrome.sidePanel.onOpened.addListener((info) => {
    if (info?.windowId) {
      openSidePanelWindows.add(info.windowId);
    }
  });
}

if (chrome.sidePanel?.onClosed) {
  chrome.sidePanel.onClosed.addListener((info) => {
    if (info?.windowId) {
      openSidePanelWindows.delete(info.windowId);
    }
  });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== SIDE_PANEL_COMMAND_ID) {
    return;
  }

  void handleOpenSidePanelCommand(tab);
});

async function initializeExtension() {
  logInfo('EXTENSION_INSTALLED', '확장 초기화 시작');

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    logDebug('SIDE_PANEL_BEHAVIOR_FAILED', 'Side Panel 동작 설정 실패', {}, error);
  }

  await registerContentScripts();
  await registerContextMenus();
}

async function openSidePanelForWindow(windowId) {
  if (!windowId || !chrome.sidePanel?.open) {
    return false;
  }

  await chrome.sidePanel.open({ windowId });
  openSidePanelWindows.add(windowId);
  return true;
}

async function closeSidePanelForWindow(windowId) {
  if (!windowId || !chrome.sidePanel?.close) {
    return false;
  }

  await chrome.sidePanel.close({ windowId });
  openSidePanelWindows.delete(windowId);
  return true;
}

async function handleOpenSidePanelCommand(tab) {
  try {
    const fallbackWindow = !tab?.windowId
      ? await chrome.windows.getLastFocused()
      : null;
    const windowId = tab?.windowId || fallbackWindow?.id;

    if (!windowId) {
      logDebug('SIDE_PANEL_SHORTCUT_SKIPPED', '사이드패널 열기 단축키를 처리하지 못했습니다.', {
        windowId: null
      });
      return;
    }

    const isOpen = openSidePanelWindows.has(windowId);
    if (isOpen) {
      const closed = await closeSidePanelForWindow(windowId);
      if (closed) {
        logInfo('SIDE_PANEL_SHORTCUT_CLOSED', '단축키로 사이드패널 닫기', { windowId });
        return;
      }
    }

    const opened = await openSidePanelForWindow(windowId);
    if (!opened) {
      logDebug('SIDE_PANEL_SHORTCUT_SKIPPED', '사이드패널 열기 단축키를 처리하지 못했습니다.', {
        windowId
      });
      return;
    }

    logInfo('SIDE_PANEL_SHORTCUT_OPENED', '단축키로 사이드패널 열기', { windowId });
  } catch (error) {
    logError('SIDE_PANEL_SHORTCUT_FAILED', '단축키로 사이드패널 열기 실패', {}, error);
  }
}

async function registerContentScripts() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['content-script'] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{
      id: 'content-script',
      js: CONTENT_SCRIPT_FILES,
      matches: ['https://*/*', 'http://*/*'],
      runAt: 'document_start',
      persistAcrossSessions: true
    }]);
    logInfo('CONTENT_SCRIPT_REGISTERED', 'Content script 등록 완료');
  } catch (error) {
    logError('CONTENT_SCRIPT_REGISTER_FAILED', 'Content script 등록 실패', {}, error);
  }
}

async function registerContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: SELECTION_CONTEXT_MENU_ROOT_ID,
      title: '웹 도우미',
      contexts: ['selection']
    });
    SELECTION_ACTIONS.forEach((action) => {
      chrome.contextMenus.create({
        id: action.contextMenuId,
        parentId: SELECTION_CONTEXT_MENU_ROOT_ID,
        title: action.label,
        contexts: ['selection']
      });
    });
    logInfo('CONTEXT_MENU_REGISTERED', '선택 번역 메뉴 등록 완료');
  } catch (error) {
    logError('CONTEXT_MENU_REGISTER_FAILED', '선택 번역 메뉴 등록 실패', {}, error);
  }
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING });
    return;
  } catch (_) {
    // inject below
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !info.selectionText) {
    return;
  }

  try {
    await ensureContentScript(tab.id);
    const selectedAction = selectionActionByMenuId.get(info.menuItemId);
    const action = selectedAction?.messageAction || '';

    if (!action) {
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { action, text: info.selectionText });
  } catch (error) {
    logError('SELECTION_MENU_DISPATCH_FAILED', '우클릭 선택 액션 전달 실패', {
      tabId: tab.id,
      menuItemId: info.menuItemId
    }, error);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === ACTIONS.GET_TOTAL_CACHE_STATUS) {
    getTotalCacheStatusFromDB()
      .then((result) => sendResponse({ success: true, count: result.count, size: result.size }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === ACTIONS.OPEN_QUICK_TRANSLATE_PANEL) {
    void (async () => {
      try {
        await chrome.storage.session.set({
          [PANEL_SESSION_KEY]: 'text',
          [STORAGE_KEYS.PENDING_QUICK_TRANSLATE]: {
            text: request.text || '',
            translation: request.translation || '',
            ts: Date.now()
          }
        });

        if (sender.tab?.windowId) {
          await openSidePanelForWindow(sender.tab.windowId);
        }

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === ACTIONS.FAST_TRANSLATE_INDEXED_TEXT) {
    translateIndexedTextFast(request.text || '', request.targetLanguage || FAST_TRANSLATE_TARGET_LANGUAGE)
      .then((translatedText) => sendResponse({ success: true, translatedText }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === ACTIONS.FETCH_HTML_FOR_BOT_AUDIT) {
    const url = request.url;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      sendResponse({ success: false, error: 'http/https URL만 지원합니다' });
      return false;
    }

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.text();
      })
      .then((html) => sendResponse({ success: true, html }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

async function translateIndexedTextFast(text, targetLanguage) {
  const payload = String(text || '').trim();
  if (!payload) {
    return '';
  }

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLanguage || FAST_TRANSLATE_TARGET_LANGUAGE)}&dt=t`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: `q=${encodeURIComponent(payload)}`
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    throw new Error((data && data.error && data.error.message) || `빠른 번역 요청 실패 (${response.status})`);
  }

  const translatedText = Array.isArray(data?.[0])
    ? data[0].map((item) => Array.isArray(item) ? (item[0] || '') : '').join('')
    : '';

  if (!translatedText.trim()) {
    throw new Error('빠른 번역 응답이 비어 있습니다.');
  }

  return translatedText;
}

async function getTotalCacheStatusFromDB() {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open('TranslationCache', 2);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('translations')) {
        db.createObjectStore('translations', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('translations_v2')) {
        db.createObjectStore('translations_v2', { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains('page_snapshots_v1')) {
        db.createObjectStore('page_snapshots_v1', { keyPath: 'hash' });
      }
    };

    request.onerror = () => reject(request.error || new Error('IndexedDB 열기 실패'));
    request.onsuccess = async (event) => {
      const db = event.target.result;
      try {
        const stores = ['translations', 'translations_v2', 'page_snapshots_v1'].filter((storeName) => db.objectStoreNames.contains(storeName));
        if (stores.length === 0) {
          db.close();
          resolve({ count: 0, size: 0 });
          return;
        }

        let totalCount = 0;
        let totalSize = 0;

        await Promise.all(stores.map((storeName) => new Promise((res, rej) => {
          const tx = db.transaction([storeName], 'readonly');
          const store = tx.objectStore(storeName);
          const getAllRequest = store.getAll();
          getAllRequest.onsuccess = () => {
            const items = getAllRequest.result || [];
            totalCount += items.length;
            totalSize += items.reduce((sum, item) => sum + JSON.stringify(item).length, 0);
            res();
          };
          getAllRequest.onerror = () => rej(getAllRequest.error);
        })));

        db.close();
        resolve({ count: totalCount, size: totalSize });
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}
