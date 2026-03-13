const tabEntries = new Map();
let activePanelTab = null;
let panelRoot = null;

function normalizeEntry(tabName, entry = {}) {
  return {
    tabName,
    init: typeof entry.init === 'function' ? entry.init : async () => {},
    onEnter: typeof entry.onEnter === 'function' ? entry.onEnter : async () => {},
    onLeave: typeof entry.onLeave === 'function' ? entry.onLeave : async () => {},
    onActiveTabChanged: typeof entry.onActiveTabChanged === 'function' ? entry.onActiveTabChanged : async () => {},
    refresh: typeof entry.refresh === 'function' ? entry.refresh : async () => {}
  };
}

function buildContext(extra = {}) {
  return {
    root: panelRoot,
    activePanelTab,
    ...extra
  };
}

export function registerTab(tabName, entry) {
  if (!tabName) {
    throw new Error('탭 이름이 필요합니다.');
  }

  tabEntries.set(tabName, normalizeEntry(tabName, entry));
}

export async function initializeRegisteredTabs(root) {
  panelRoot = root || document;

  for (const entry of tabEntries.values()) {
    await entry.init(buildContext({ panelTab: entry.tabName }));
  }
}

export function getActiveRegisteredTab() {
  return activePanelTab;
}

export async function activateRegisteredTab(tabName, context = {}) {
  const nextEntry = tabEntries.get(tabName);
  if (!nextEntry) {
    return;
  }

  if (activePanelTab === tabName) {
    await nextEntry.refresh(buildContext({
      panelTab: tabName,
      ...context
    }));
    return;
  }

  const previousTab = activePanelTab;
  const previousEntry = previousTab ? tabEntries.get(previousTab) : null;
  if (previousEntry) {
    await previousEntry.onLeave(buildContext({
      panelTab: previousTab,
      nextPanelTab: tabName,
      ...context
    }));
  }

  activePanelTab = tabName;

  await nextEntry.onEnter(buildContext({
    panelTab: tabName,
    previousPanelTab: previousTab,
    ...context
  }));
}

export async function refreshRegisteredTab(tabName, context = {}) {
  const entry = tabEntries.get(tabName);
  if (!entry) {
    return;
  }

  await entry.refresh(buildContext({
    panelTab: tabName,
    ...context
  }));
}

export async function notifyActiveBrowserTabChanged(browserTab, context = {}) {
  for (const entry of tabEntries.values()) {
    await entry.onActiveTabChanged(browserTab, buildContext({
      panelTab: entry.tabName,
      browserTab,
      ...context
    }));
  }
}

