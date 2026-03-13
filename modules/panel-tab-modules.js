import { DEFAULT_TRANSLATE_PANEL } from './panel-constants.js';
import { getActiveTranslateSubtab, switchTranslateSubtab } from './ui-utils.js';
import { initHistoryTab } from './history.js';
import { initSettingsTab, loadSettings, updatePageCacheStatus } from './settings.js';
import { initializeSearchTab } from './search.js';
import { initQuickTranslateTab } from './quick-translate.js';
import { initRecurringTab } from './recurring.js';
import { initGeoTab } from './geo-tab.js';
import { initToolsTab, refreshToolsTab, handleToolsTabContextChange } from './tools.js';
import { handleTabChange, initTranslationTab } from './translation.js';
import { initErrorCenterTab, refreshErrorCenterTab } from './error-center.js';

function resolveTranslatePanel(context = {}) {
  return context.translatePanel || getActiveTranslateSubtab() || DEFAULT_TRANSLATE_PANEL;
}

export function createPanelTabModules() {
  return {
    translate: {
      init: async () => {
        await initTranslationTab();
        await initHistoryTab();
        await initQuickTranslateTab();
      },
      onEnter: async (context) => {
        await switchTranslateSubtab(resolveTranslatePanel(context));
      },
      refresh: async (context) => {
        await switchTranslateSubtab(resolveTranslatePanel(context));
      },
      onActiveTabChanged: async (browserTab) => {
        await handleTabChange(browserTab);
      }
    },
    search: {
      init: async () => {
        initializeSearchTab();
      },
      onEnter: async () => {
        initializeSearchTab();
      },
      refresh: async () => {
        initializeSearchTab();
      }
    },
    geo: {
      init: async () => {
        initGeoTab();
      }
    },
    tools: {
      init: async () => {
        initToolsTab();
      },
      onEnter: async (context) => {
        await refreshToolsTab({ tab: context.browserTab || null });
      },
      refresh: async (context) => {
        await refreshToolsTab({ tab: context.browserTab || null });
      },
      onActiveTabChanged: async (browserTab) => {
        await handleToolsTabContextChange(browserTab);
      }
    },
    recurring: {
      init: async () => {
        await initRecurringTab();
      }
    },
    errors: {
      init: async () => {
        initErrorCenterTab();
      },
      onEnter: async () => {
        await refreshErrorCenterTab();
      },
      refresh: async () => {
        await refreshErrorCenterTab();
      }
    },
    settings: {
      init: async () => {
        initSettingsTab();
      },
      onEnter: async () => {
        await loadSettings();
      },
      refresh: async () => {
        await loadSettings();
      },
      onActiveTabChanged: async () => {
        await updatePageCacheStatus();
      }
    }
  };
}
