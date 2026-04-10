/**
 * Content Selection Module
 * - 드래그 선택 그룹 액션바/팝오버 UI
 */
(function selectionModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    const SELECTION_ACTIONS = Array.isArray(WPT.Constants?.SELECTION_ACTIONS)
      ? WPT.Constants.SELECTION_ACTIONS
      : [
          { key: 'translate', label: '번역', tone: 'primary', messageAction: 'TRANSLATE_SELECTION' },
          { key: 'copy', label: '복사', tone: 'secondary', messageAction: 'COPY_SELECTION' },
          { key: 'explain', label: '설명하기', tone: 'secondary', messageAction: 'EXPLAIN_SELECTION' },
          { key: 'search', label: '검색', tone: 'secondary', messageAction: 'SEARCH_SELECTION' }
        ];
    const SELECTION_SEARCH_TARGETS = Array.isArray(WPT.Constants?.SELECTION_SEARCH_TARGETS)
      ? WPT.Constants.SELECTION_SEARCH_TARGETS
      : [
          { key: 'google', label: 'Google' },
          { key: 'naver', label: 'Naver' },
          { key: 'bing', label: 'Bing' },
          { key: 'chatgpt', label: 'ChatGPT' },
          { key: 'perplexity', label: 'Perplexity' },
          { key: 'all', label: '전체 검색' }
        ];
    const ACTION_TRANSLATE = SELECTION_ACTIONS.find((action) => action.key === 'translate')?.key || 'translate';
    const ACTION_COPY = SELECTION_ACTIONS.find((action) => action.key === 'copy')?.key || 'copy';
    const ACTION_EXPLAIN = SELECTION_ACTIONS.find((action) => action.key === 'explain')?.key || 'explain';
    const ACTION_SEARCH = SELECTION_ACTIONS.find((action) => action.key === 'search')?.key || 'search';
    const ACTION_BAR_ID = 'wpt-selection-action-bar';
    const POPOVER_ID = 'wpt-selection-popover';
    const MODULE_GUARD_ATTR = 'data-wpt-selection-mounted';
    const BUTTON_RESET_MS = 1200;
    const RELEVANT_STORAGE_KEYS = new Set([
      'selectionTranslateEnabled',
      'selectionTranslateMode',
      'selectionPopoverCloseOnBackdrop',
      'defaultProvider',
      'defaultModel',
      'translationProfile',
      'openRouterApiKey',
      'openAIApiKey',
      'geminiApiKey'
    ]);

    let enabled = true;
    let actionBarEl = null;
    let popoverEl = null;
    let initialized = false;
    let currentSelectionRect = null;
    let currentSelectionText = '';
    let selectionChangeTimer = null;
    let lastPointerAnchor = null;
    let activeRequestController = null;
    let activeConfig = createFallbackConfig();
    let popoverDragState = null;
    let popoverPinnedPosition = null;
    const actionButtons = {};
    const buttonResetTimers = new Map();

    function createFallbackConfig() {
      return {
        provider: 'openrouter',
        providerLabel: 'OpenRouter',
        apiKey: '',
        hasApiKey: false,
        model: 'google/gemini-3.1-flash-lite-preview',
        selectionTranslateEnabled: true,
        selectionTranslateMode: 'fast',
        selectionPopoverCloseOnBackdrop: false
      };
    }

    function ensureUi() {
      if (!actionBarEl) {
        actionBarEl = document.getElementById(ACTION_BAR_ID);
        if (!actionBarEl) {
          actionBarEl = document.createElement('div');
          actionBarEl.id = ACTION_BAR_ID;
          actionBarEl.style.cssText = [
            'position:fixed',
            'z-index:2147483646',
            'display:none',
            'align-items:center',
            'gap:4px',
            'padding:4px',
            'border-radius:999px',
            'background:rgba(9,12,17,0.94)',
            'border:1px solid rgba(255,255,255,0.1)',
            'box-shadow:0 14px 32px rgba(2,6,23,0.28)',
            'backdrop-filter:blur(10px)'
          ].join(';');
          document.documentElement.appendChild(actionBarEl);
        }

        if (!actionBarEl.dataset.wptBound) {
          actionBarEl.addEventListener('mousedown', (event) => {
            event.preventDefault();
          });
          actionBarEl.dataset.wptBound = 'true';
        }

        SELECTION_ACTIONS.forEach((action) => {
          const selector = `button[data-action="${action.key}"]`;
          let button = actionBarEl.querySelector(selector);
          if (!button) {
            button = createActionButton(action.label, action.key, action.tone || 'secondary');
            actionBarEl.appendChild(button);
          } else if (!button.dataset.wptBound) {
            button.addEventListener('click', () => {
              void handleActionClick(action.key).catch(() => {});
            });
            button.dataset.wptBound = 'true';
          }

          actionButtons[action.key] = button;
        });
      }

      if (!popoverEl) {
        popoverEl = document.getElementById(POPOVER_ID);
        if (!popoverEl) {
          popoverEl = document.createElement('div');
          popoverEl.id = POPOVER_ID;
          popoverEl.style.cssText = [
            'position:fixed',
            'z-index:2147483647',
            'display:none',
            'width:min(380px, calc(100vw - 24px))',
            'padding:14px',
            'border-radius:16px',
            'background:rgba(11,11,15,0.97)',
            'color:#EDEEF0',
            'box-shadow:0 18px 48px rgba(0,0,0,0.28)',
            'border:1px solid rgba(255,255,255,0.08)'
          ].join(';');
          document.documentElement.appendChild(popoverEl);
        }
      }
    }

    function createActionButton(label, action, tone) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.action = action;
      button.dataset.defaultLabel = label;
      button.dataset.tone = tone;
      button.dataset.wptBound = 'true';
      button.style.cssText = getActionButtonCss({ tone, disabled: false });
      button.addEventListener('click', () => {
        void handleActionClick(action).catch(() => {});
      });
      return button;
    }

    function getActionButtonCss(options) {
      const tone = options && options.tone ? options.tone : 'secondary';
      const disabled = Boolean(options && options.disabled);
      const shared = [
        'border:none',
        'min-height:32px',
        'padding:0 12px',
        'border-radius:999px',
        'font-size:12px',
        'font-weight:700',
        'line-height:1',
        'transition:all 0.18s ease',
        'white-space:nowrap'
      ];

      if (disabled) {
        return [
          ...shared,
          'background:rgba(255,255,255,0.06)',
          'color:#7C8492',
          'cursor:not-allowed',
          'opacity:0.72'
        ].join(';');
      }

      if (tone === 'primary') {
        return [
          ...shared,
          'background:#2A6CF0',
          'color:#FFFFFF',
          'cursor:pointer',
          'box-shadow:0 6px 16px rgba(42,108,240,0.28)'
        ].join(';');
      }

      return [
        ...shared,
        'background:rgba(255,255,255,0.06)',
        'color:#EDEEF0',
        'cursor:pointer'
      ].join(';');
    }

    function applyButtonVisual(button) {
      if (!button) {
        return;
      }

      const tone = button.dataset.tone || 'secondary';
      button.style.cssText = getActionButtonCss({
        tone,
        disabled: button.disabled
      });
    }

    async function syncConfig() {
      try {
        const config = WPT.Provider && WPT.Provider.getActiveConfig
          ? await WPT.Provider.getActiveConfig()
          : createFallbackConfig();
        activeConfig = Object.assign(createFallbackConfig(), config || {});
        enabled = activeConfig.selectionTranslateEnabled !== false;
      } catch (_) {
        activeConfig = createFallbackConfig();
        enabled = true;
      }

      updateActionAvailability();
      if (!enabled) {
        hideChip();
        hidePopover();
      }
    }

    function updateActionAvailability() {
      ensureUi();
      const explainButton = actionButtons[ACTION_EXPLAIN];
      if (!explainButton) {
        return;
      }

      const explainDisabled = !activeConfig.hasApiKey;
      explainButton.disabled = explainDisabled;
      explainButton.title = explainDisabled
        ? '현재 AI 설정의 API Key를 저장하면 사용할 수 있습니다.'
        : `${activeConfig.providerLabel || '현재 AI'} 모델로 설명합니다.`;
      applyButtonVisual(explainButton);
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function normalizeRect(rect) {
      if (!rect) {
        return null;
      }

      const left = Number(rect.left);
      const top = Number(rect.top);
      const width = Number(rect.width);
      const height = Number(rect.height);
      const right = Number(rect.right);
      const bottom = Number(rect.bottom);

      if (![left, top, width, height, right, bottom].every(Number.isFinite)) {
        return null;
      }

      return {
        left,
        top,
        width,
        height,
        right,
        bottom
      };
    }

    function getRectCenter(rect) {
      return {
        x: rect.left + (rect.width / 2),
        y: rect.top + (rect.height / 2)
      };
    }

    function pickBestClientRect(rectList, anchor) {
      const rects = Array.from(rectList || [])
        .map((rect) => normalizeRect(rect))
        .filter((rect) => rect && (rect.width > 1 || rect.height > 1));

      if (rects.length === 0) {
        return null;
      }

      if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
        return rects[rects.length - 1];
      }

      const containingRect = rects.find((rect) => (
        anchor.x >= rect.left - 2
        && anchor.x <= rect.right + 2
        && anchor.y >= rect.top - 2
        && anchor.y <= rect.bottom + 2
      ));
      if (containingRect) {
        return containingRect;
      }

      return rects.reduce((best, rect) => {
        if (!best) {
          return rect;
        }

        const bestCenter = getRectCenter(best);
        const rectCenter = getRectCenter(rect);
        const bestDistance = Math.hypot(bestCenter.x - anchor.x, bestCenter.y - anchor.y);
        const rectDistance = Math.hypot(rectCenter.x - anchor.x, rectCenter.y - anchor.y);
        return rectDistance < bestDistance ? rect : best;
      }, null);
    }

    function normalizeSelectionText(text) {
      return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    }

    function getSelectionTextFromRange(range) {
      if (!range) {
        return '';
      }

      // Some pages emit browser-level CSP/font noise while selection.toString() touches layout text.
      // Reading cloned fragment text keeps the selection feature working without pulling that path in first.
      try {
        const fragment = range.cloneContents();
        const fragmentText = normalizeSelectionText(fragment.textContent || '');
        if (fragmentText) {
          return fragmentText;
        }
      } catch (_) {
      }

      try {
        return normalizeSelectionText(range.toString());
      } catch (_) {
        return '';
      }
    }

    function isSupportedSelectionLength(text) {
      return Boolean(text && text.length >= 2 && text.length <= 800);
    }

    function isTextFieldElement(element) {
      if (element instanceof HTMLTextAreaElement) {
        return true;
      }

      if (!(element instanceof HTMLInputElement)) {
        return false;
      }

      const type = String(element.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'email'].includes(type);
    }

    function getTextFieldSelection(target) {
      const activeElement = document.activeElement;
      const element = isTextFieldElement(target)
        ? target
        : (isTextFieldElement(activeElement) ? activeElement : null);

      if (!element) {
        return null;
      }

      const start = Number(element.selectionStart);
      const end = Number(element.selectionEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      const text = normalizeSelectionText(element.value.slice(start, end));
      if (!isSupportedSelectionLength(text)) {
        return null;
      }

      const rect = element.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }

      return {
        text,
        rect: {
          left: rect.left + Math.min(16, Math.max(rect.width - 48, 0)),
          top: rect.top + Math.min(18, Math.max(rect.height / 2, 0)),
          width: Math.max(rect.width, 40),
          height: Math.max(rect.height, 24),
          right: rect.right,
          bottom: rect.bottom
        }
      };
    }

    function positionElement(element, rect, topOffset, anchor) {
      if (!element || !rect) {
        return;
      }

      const elementWidth = Math.max(element.offsetWidth || 0, 72);
      const maxLeft = Math.max(12, window.innerWidth - elementWidth - 12);
      const anchorX = Number.isFinite(anchor?.x) ? anchor.x : rect.left;
      const preferredLeft = Number.isFinite(rect.right) && anchorX >= rect.left
        ? Math.min(Math.max(anchorX - (elementWidth / 2), rect.left), rect.right - 12)
        : rect.left;
      const left = clamp(preferredLeft, 12, maxLeft);
      const top = clamp(rect.top - topOffset, 12, window.innerHeight - 92);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }

    function getFallbackRect() {
      return {
        left: 12,
        top: 72,
        width: 160,
        height: 24,
        right: 172,
        bottom: 96
      };
    }

    function hideChip() {
      if (actionBarEl) {
        actionBarEl.style.display = 'none';
      }
    }

    function hidePopover() {
      abortActiveRequest();
      popoverDragState = null;
      popoverPinnedPosition = null;
      if (popoverEl) {
        popoverEl.style.display = 'none';
      }
    }

    function isPopoverOpen() {
      return Boolean(popoverEl && popoverEl.style.display !== 'none');
    }

    function showPopoverFeedback(message, isError) {
      if (!popoverEl) {
        return;
      }

      const feedbackEl = popoverEl.querySelector('[data-role="copy-feedback"]');
      if (!feedbackEl) {
        return;
      }

      feedbackEl.textContent = message || '';
      feedbackEl.style.opacity = message ? '1' : '0';
      feedbackEl.style.color = isError ? '#FCA5A5' : '#93C5FD';
    }

    async function writeClipboardText(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.cssText = 'position:fixed; left:-9999px; top:-9999px; opacity:0;';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!copied) {
        throw new Error('clipboard_copy_failed');
      }
    }

    async function handlePopoverCopyAction(text, label) {
      if (!text) {
        showPopoverFeedback(`${label}이 없습니다.`, true);
        return;
      }

      try {
        await writeClipboardText(text);
        showPopoverFeedback(`${label}이 복사되었습니다.`, false);
      } catch (_) {
        showPopoverFeedback('복사에 실패했습니다.', true);
      }
    }

    function setTemporaryButtonLabel(action, label, isError) {
      const button = actionButtons[action];
      if (!button) {
        return;
      }

      if (buttonResetTimers.has(action)) {
        clearTimeout(buttonResetTimers.get(action));
      }

      const defaultLabel = button.dataset.defaultLabel || label;
      button.textContent = label;

      if (isError) {
        button.style.background = 'rgba(239,68,68,0.18)';
        button.style.color = '#FCA5A5';
      }

      buttonResetTimers.set(action, setTimeout(() => {
        button.textContent = defaultLabel;
        buttonResetTimers.delete(action);
        applyButtonVisual(button);
      }, BUTTON_RESET_MS));
    }

    function readWindowSelection(anchor) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return null;
      }

      const range = selection.getRangeAt(0);
      const text = getSelectionTextFromRange(range);
      if (!isSupportedSelectionLength(text)) {
        return null;
      }

      const rect = pickBestClientRect(range.getClientRects(), anchor) || normalizeRect(range.getBoundingClientRect());
      if (!rect || (!rect.width && !rect.height)) {
        return null;
      }

      return { text, rect };
    }

    function readSelection(target, anchor) {
      const selected = getTextFieldSelection(target) || readWindowSelection(anchor);
      if (!selected) {
        currentSelectionRect = null;
        currentSelectionText = '';
        return null;
      }

      const { text, rect } = selected;
      currentSelectionRect = rect;
      currentSelectionText = text;
      return { text, rect };
    }

    function updateChipFromSelection(target, anchor) {
      if (!enabled) {
        hideChip();
        return;
      }

      const previousText = currentSelectionText;
      const selected = readSelection(target, anchor);
      if (!selected) {
        hideChip();
        return;
      }

      if (selected.text !== previousText) {
        hidePopover();
      }

      ensureUi();
      updateActionAvailability();
      actionBarEl.style.display = 'inline-flex';
      positionElement(actionBarEl, selected.rect, 52, anchor);
    }

    function getPopoverTitle(mode) {
      if (mode === ACTION_EXPLAIN) {
        return '선택 텍스트 설명';
      }

      if (mode === ACTION_SEARCH) {
        return '선택 텍스트 검색';
      }

      return '선택 텍스트 번역';
    }

    function getPopoverLoadingText(mode) {
      return mode === ACTION_EXPLAIN ? '설명 중...' : '번역 중...';
    }

    function getResultCopyLabel(mode) {
      return mode === ACTION_EXPLAIN ? '설명 복사' : '번역 복사';
    }

    function getResultBodyLabel(mode) {
      return mode === ACTION_EXPLAIN ? '설명' : '번역문';
    }

    function getSearchTargetButtonStyle(isAll) {
      return [
        'border:none',
        'border-radius:10px',
        'padding:9px 10px',
        isAll ? 'background:#2A6CF0' : 'background:rgba(255,255,255,0.06)',
        isAll ? 'color:#FFFFFF' : 'color:#EDEEF0',
        'cursor:pointer',
        'font-size:12px',
        'font-weight:700',
        'white-space:nowrap'
      ].join(';');
    }

    async function openSelectionSearch(engine, text) {
      const payload = normalizeSelectionText(text);
      if (!payload) {
        throw new Error('검색할 선택 텍스트가 없습니다.');
      }

      const response = await chrome.runtime.sendMessage({
        action: WPT.Constants?.ACTIONS?.SEARCH_SELECTION || 'SEARCH_SELECTION',
        engine,
        text: payload
      });

      if (!response || response.success !== true) {
        throw new Error(response?.error || '검색을 열지 못했습니다.');
      }

      return response;
    }

    async function handleSearchTargetClick(engine, text) {
      const target = SELECTION_SEARCH_TARGETS.find((item) => item.key === engine);
      const label = target ? target.label : '검색';

      try {
        const response = await openSelectionSearch(engine, text);
        showPopoverFeedback(`${response.label || label}을 새 탭으로 열었습니다.`, false);
        setTemporaryButtonLabel(ACTION_SEARCH, '열림', false);
      } catch (error) {
        showPopoverFeedback(error?.message || '검색을 열지 못했습니다.', true);
        setTemporaryButtonLabel(ACTION_SEARCH, '실패', true);
      }
    }

    function renderSearchPopover(sourceText) {
      const searchButtons = SELECTION_SEARCH_TARGETS
        .map((target) => `
          <button
            type="button"
            data-role="search-target"
            data-engine="${escapeHtml(target.key)}"
            style="${getSearchTargetButtonStyle(target.key === 'all')}"
          >
            ${escapeHtml(target.label)}
          </button>
        `)
        .join('');

      popoverEl.innerHTML = `
        <div data-role="drag-handle" style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; cursor:move; user-select:none;">
          <div style="font-size:13px; font-weight:700;">${escapeHtml(getPopoverTitle(ACTION_SEARCH))}</div>
          <button type="button" data-role="close" style="background:none; border:none; color:#A9AFB8; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="font-size:12px; color:#A9AFB8; margin-bottom:8px;">${escapeHtml(sourceText)}</div>
        <div style="font-size:12px; color:#CBD5E1; margin-bottom:10px;">검색할 엔진을 선택하세요.</div>
        <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px;">
          ${searchButtons}
        </div>
        <div data-role="copy-feedback" style="min-height:18px; margin-top:10px; font-size:12px; opacity:0; transition:opacity 0.16s ease;"></div>
      `;

      popoverEl.querySelector('[data-role="drag-handle"]')?.addEventListener('mousedown', handlePopoverDragStart);
      popoverEl.querySelector('[data-role="close"]')?.addEventListener('click', hidePopover);
      popoverEl.querySelectorAll('[data-role="search-target"]').forEach((button) => {
        button.addEventListener('click', () => {
          void handleSearchTargetClick(button.getAttribute('data-engine') || '', sourceText);
        });
      });
    }

    function renderPopover(view) {
      if (!popoverEl) {
        return;
      }

      const mode = view && view.mode ? view.mode : ACTION_TRANSLATE;
      const sourceText = view && view.sourceText ? view.sourceText : '';
      if (mode === ACTION_SEARCH) {
        renderSearchPopover(sourceText);
        return;
      }

      const resultText = view && view.resultText ? view.resultText : '';
      const errorMessage = view && view.errorMessage ? view.errorMessage : '';
      const isLoading = Boolean(view && view.isLoading);
      const hasResult = Boolean(!isLoading && !errorMessage && resultText);
      const resultButtonStyle = [
        'flex:1',
        'display:inline-flex',
        'align-items:center',
        'justify-content:center',
        'border-radius:10px',
        'padding:9px 10px',
        'line-height:1.2',
        'font-weight:700',
        hasResult ? 'border:1px solid rgba(255,255,255,0.12)' : 'border:1px solid rgba(255,255,255,0.08)',
        hasResult ? 'background:rgba(255,255,255,0.04)' : 'background:rgba(255,255,255,0.02)',
        hasResult ? 'color:#EDEEF0' : 'color:#667085',
        hasResult ? 'cursor:pointer' : 'cursor:not-allowed'
      ].join(';');
      const resultColor = errorMessage ? '#FCA5A5' : '#EDEEF0';

      popoverEl.innerHTML = `
        <div data-role="drag-handle" style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; cursor:move; user-select:none;">
          <div style="font-size:13px; font-weight:700;">${escapeHtml(getPopoverTitle(mode))}</div>
          <button type="button" data-role="close" style="background:none; border:none; color:#A9AFB8; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="font-size:12px; color:#A9AFB8; margin-bottom:8px;">${escapeHtml(sourceText)}</div>
        <div style="min-height:56px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.04); color:${resultColor}; font-size:13px; line-height:1.6;">
          ${escapeHtml(isLoading ? getPopoverLoadingText(mode) : (errorMessage || resultText || ''))}
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button type="button" data-role="copy-source" style="flex:1; display:inline-flex; align-items:center; justify-content:center; border:none; border-radius:10px; padding:9px 10px; line-height:1.2; font-weight:700; background:#2A6CF0; color:white; cursor:pointer;">원문 복사</button>
          <button type="button" data-role="copy-result" ${hasResult ? '' : 'disabled'} style="${resultButtonStyle}">${escapeHtml(getResultCopyLabel(mode))}</button>
        </div>
        <div data-role="copy-feedback" style="min-height:18px; margin-top:8px; font-size:12px; opacity:0; transition:opacity 0.16s ease;"></div>
      `;

      popoverEl.querySelector('[data-role="drag-handle"]')?.addEventListener('mousedown', handlePopoverDragStart);
      popoverEl.querySelector('[data-role="close"]')?.addEventListener('click', hidePopover);
      popoverEl.querySelector('[data-role="copy-source"]')?.addEventListener('click', async () => {
        await handlePopoverCopyAction(sourceText, '원문');
      });
      popoverEl.querySelector('[data-role="copy-result"]')?.addEventListener('click', async () => {
        await handlePopoverCopyAction(resultText, getResultBodyLabel(mode));
      });
    }

    function positionPopoverByCoords(left, top) {
      if (!popoverEl) {
        return;
      }

      const width = Math.max(popoverEl.offsetWidth || 0, 280);
      const height = Math.max(popoverEl.offsetHeight || 0, 120);
      const maxLeft = Math.max(12, window.innerWidth - width - 12);
      const maxTop = Math.max(12, window.innerHeight - height - 12);
      const nextLeft = clamp(Number(left) || 12, 12, maxLeft);
      const nextTop = clamp(Number(top) || 12, 12, maxTop);

      popoverEl.style.left = `${nextLeft}px`;
      popoverEl.style.top = `${nextTop}px`;
      popoverPinnedPosition = { left: nextLeft, top: nextTop };
    }

    function handlePopoverDragStart(event) {
      if (!popoverEl || event.button !== 0) {
        return;
      }

      const closeButton = event.target instanceof Element
        ? event.target.closest('[data-role="close"]')
        : null;
      if (closeButton) {
        return;
      }

      const rect = popoverEl.getBoundingClientRect();
      popoverDragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };
      popoverPinnedPosition = {
        left: rect.left,
        top: rect.top
      };
      event.preventDefault();
    }

    function handlePopoverDragMove(event) {
      if (!popoverDragState || !popoverEl || popoverEl.style.display === 'none') {
        return;
      }

      positionPopoverByCoords(
        event.clientX - popoverDragState.offsetX,
        event.clientY - popoverDragState.offsetY
      );
      event.preventDefault();
    }

    function handlePopoverDragEnd() {
      popoverDragState = null;
    }

    function showPopover(view) {
      ensureUi();
      renderPopover(view);
      popoverEl.style.display = 'block';

      if (popoverPinnedPosition) {
        positionPopoverByCoords(popoverPinnedPosition.left, popoverPinnedPosition.top);
        return;
      }

      positionElement(popoverEl, currentSelectionRect || getFallbackRect(), -18, lastPointerAnchor);
    }

    function abortActiveRequest() {
      if (activeRequestController) {
        activeRequestController.abort();
        activeRequestController = null;
      }
    }

    function resolveTranslateRequestConfig(config) {
      const selectionMode = config && config.selectionTranslateMode === 'provider' ? 'provider' : 'fast';
      const provider = selectionMode === 'provider'
        ? config.provider
        : (WPT.Provider && WPT.Provider.FAST_PAGE_PROVIDER ? WPT.Provider.FAST_PAGE_PROVIDER : 'builtin-fast');
      const model = selectionMode === 'provider'
        ? config.model
        : (WPT.Provider && WPT.Provider.FAST_PAGE_MODEL ? WPT.Provider.FAST_PAGE_MODEL : 'google-web-mt');
      const apiKey = selectionMode === 'provider' ? config.apiKey : '';

      if (!config || (selectionMode === 'provider' && !config.hasApiKey)) {
        throw new Error('활성 프로바이더 API Key가 필요합니다.');
      }

      return {
        provider,
        model,
        apiKey
      };
    }

    function resolveExplainRequestConfig(config) {
      if (!config || !config.hasApiKey) {
        throw new Error('설명하기는 현재 AI 설정의 API Key가 필요합니다.');
      }

      return {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey
      };
    }

    async function runSelectionAction(mode, text, options) {
      ensureUi();
      abortActiveRequest();

      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      activeRequestController = controller;

      showPopover({
        mode,
        sourceText: text,
        resultText: '',
        errorMessage: '',
        isLoading: true
      });
      hideChip();

      try {
        const config = WPT.Provider && WPT.Provider.getActiveConfig
          ? await WPT.Provider.getActiveConfig()
          : createFallbackConfig();
        activeConfig = Object.assign(createFallbackConfig(), config || {});
        updateActionAvailability();

        const requestConfig = mode === ACTION_EXPLAIN
          ? resolveExplainRequestConfig(activeConfig)
          : resolveTranslateRequestConfig(activeConfig);

        const runner = mode === ACTION_EXPLAIN
          ? (WPT.Provider && WPT.Provider.explainSelection)
          : (WPT.Provider && WPT.Provider.translateSelection);

        const resultText = runner
          ? await runner({
            provider: requestConfig.provider,
            apiKey: requestConfig.apiKey,
            model: requestConfig.model,
            text,
            signal: controller ? controller.signal : undefined
          })
          : '';

        if (controller && controller.signal.aborted) {
          return '';
        }

        showPopover({
          mode,
          sourceText: text,
          resultText,
          errorMessage: '',
          isLoading: false
        });
        void options;
        return resultText;
      } catch (error) {
        if (WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error)) {
          return '';
        }

        showPopover({
          mode,
          sourceText: text,
          resultText: '',
          errorMessage: error && error.message ? error.message : '처리에 실패했습니다.',
          isLoading: false
        });
        throw error;
      } finally {
        if (activeRequestController === controller) {
          activeRequestController = null;
        }
      }
    }

    async function copyCurrentSelectionText() {
      const text = currentSelectionText || (readSelection(document.activeElement, lastPointerAnchor) && currentSelectionText);
      if (!text) {
        setTemporaryButtonLabel(ACTION_COPY, '없음', true);
        return;
      }

      try {
        await writeClipboardText(text);
        setTemporaryButtonLabel(ACTION_COPY, '복사됨', false);
      } catch (_) {
        setTemporaryButtonLabel(ACTION_COPY, '실패', true);
      }
    }

    async function copySelectionText(text, options) {
      const resolvedText = normalizeSelectionText(text)
        || currentSelectionText
        || (readSelection(document.activeElement, lastPointerAnchor) && currentSelectionText)
        || '';

      if (!resolvedText) {
        throw new Error('복사할 선택 텍스트가 없습니다.');
      }

      await writeClipboardText(resolvedText);

      if (options?.showFeedback !== false) {
        setTemporaryButtonLabel(ACTION_COPY, '복사됨', false);
      }

      return resolvedText;
    }

    async function translateSelectionText(text, options) {
      return await runSelectionAction(ACTION_TRANSLATE, text, options || {});
    }

    async function translateCurrentSelection(options) {
      const text = currentSelectionText || (readSelection(document.activeElement, lastPointerAnchor) && currentSelectionText);
      if (!text) {
        return '';
      }
      return await translateSelectionText(text, options || {});
    }

    async function explainSelectionText(text, options) {
      return await runSelectionAction(ACTION_EXPLAIN, text, options || {});
    }

    async function explainCurrentSelection(options) {
      const text = currentSelectionText || (readSelection(document.activeElement, lastPointerAnchor) && currentSelectionText);
      if (!text) {
        return '';
      }
      return await explainSelectionText(text, options || {});
    }

    function showSearchPopoverForSelection(text) {
      const resolvedText = normalizeSelectionText(text)
        || currentSelectionText
        || (readSelection(document.activeElement, lastPointerAnchor) && currentSelectionText)
        || '';

      if (!resolvedText) {
        setTemporaryButtonLabel(ACTION_SEARCH, '없음', true);
        return;
      }

      showPopover({
        mode: ACTION_SEARCH,
        sourceText: resolvedText
      });
      hideChip();
    }

    async function handleActionClick(action) {
      if (action === ACTION_COPY) {
        await copyCurrentSelectionText();
        return;
      }

      if (action === ACTION_EXPLAIN) {
        if (actionButtons[ACTION_EXPLAIN]?.disabled) {
          return;
        }
        await explainCurrentSelection({ source: 'action-bar' });
        return;
      }

      if (action === ACTION_SEARCH) {
        showSearchPopoverForSelection(currentSelectionText);
        return;
      }

      await translateCurrentSelection({ source: 'action-bar' });
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    function handlePointerUp(event) {
      const target = event ? event.target : document.activeElement;
      lastPointerAnchor = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? { x: event.clientX, y: event.clientY }
        : null;
      setTimeout(() => updateChipFromSelection(target, lastPointerAnchor), 30);
    }

    function handleSelectionChange() {
      if (selectionChangeTimer) {
        clearTimeout(selectionChangeTimer);
      }
      selectionChangeTimer = setTimeout(() => {
        updateChipFromSelection(document.activeElement, lastPointerAnchor);
      }, 30);
    }

    function handleDocumentClick(event) {
      const target = event.target;
      if (actionBarEl && actionBarEl.contains(target)) {
        return;
      }
      if (popoverEl && popoverEl.contains(target)) {
        return;
      }
      if (activeConfig.selectionPopoverCloseOnBackdrop === true && isPopoverOpen()) {
        hidePopover();
      }
      if (!(target instanceof Node) || !window.getSelection || !window.getSelection()?.toString()) {
        hideChip();
      }
    }

    async function init() {
      if (initialized) {
        return;
      }

      if (document.documentElement.getAttribute(MODULE_GUARD_ATTR) === 'true') {
        ensureUi();
        updateActionAvailability();
        return;
      }

      initialized = true;
      document.documentElement.setAttribute(MODULE_GUARD_ATTR, 'true');
      ensureUi();
      await syncConfig();

      document.addEventListener('mouseup', handlePointerUp, true);
      document.addEventListener('keyup', handlePointerUp, true);
      document.addEventListener('selectionchange', handleSelectionChange, true);
      document.addEventListener('scroll', hideChip, true);
      document.addEventListener('click', handleDocumentClick, true);
      document.addEventListener('mousemove', handlePopoverDragMove, true);
      document.addEventListener('mouseup', handlePopoverDragEnd, true);
      window.addEventListener('blur', handlePopoverDragEnd);

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') {
          return;
        }

        const changedKeys = Object.keys(changes || {});
        if (!changedKeys.some((key) => RELEVANT_STORAGE_KEYS.has(key))) {
          return;
        }

        void syncConfig().then(() => {
          if (currentSelectionText) {
            updateChipFromSelection(document.activeElement, lastPointerAnchor);
          }
        });
      });
    }

    WPT.Selection = {
      init,
      translateSelectionText,
      translateCurrentSelection,
      copySelectionText,
      explainSelectionText,
      explainCurrentSelection,
      showSearchPopoverForSelection,
      hideChip,
      hidePopover
    };

    void init();
  } catch (_) {
    // no-op
  }
})();
