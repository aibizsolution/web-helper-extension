/**
 * Content Selection Module
 * - 드래그 선택 번역 플로팅 버튼/팝오버 UI
 */
(function selectionModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    let enabled = true;
    let chipEl = null;
    let popoverEl = null;
    let initialized = false;
    let currentSelectionRect = null;
    let currentSelectionText = '';
    let selectionChangeTimer = null;
    let popoverAutoCloseTimer = null;
    let lastPointerAnchor = null;

    function ensureUi() {
      if (!chipEl) {
        chipEl = document.createElement('button');
        chipEl.type = 'button';
        chipEl.textContent = '번역';
        chipEl.style.cssText = [
          'position: fixed',
          'z-index: 2147483646',
          'display: none',
          'padding: 8px 12px',
          'border-radius: 999px',
          'border: none',
          'background: #2A6CF0',
          'color: white',
          'font-size: 12px',
          'font-weight: 700',
          'box-shadow: 0 10px 28px rgba(15,23,42,0.24)',
          'cursor: pointer'
        ].join(';');
        chipEl.addEventListener('click', () => {
          void translateCurrentSelection({ source: 'chip' });
        });
        document.documentElement.appendChild(chipEl);
      }

      if (!popoverEl) {
        popoverEl = document.createElement('div');
        popoverEl.style.cssText = [
          'position: fixed',
          'z-index: 2147483647',
          'display: none',
          'width: min(360px, calc(100vw - 24px))',
          'padding: 14px',
          'border-radius: 16px',
          'background: rgba(11,11,15,0.97)',
          'color: #EDEEF0',
          'box-shadow: 0 18px 48px rgba(0,0,0,0.28)',
          'border: 1px solid rgba(255,255,255,0.08)'
        ].join(';');
        document.documentElement.appendChild(popoverEl);
      }
    }

    async function syncEnabled() {
      try {
        const config = WPT.Provider && WPT.Provider.getActiveConfig
          ? await WPT.Provider.getActiveConfig()
          : { selectionTranslateEnabled: true };
        enabled = config.selectionTranslateEnabled !== false;
      } catch (_) {
        enabled = true;
      }
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

    function isSupportedSelectionLength(text) {
      return Boolean(text && text.length >= 2 && text.length <= 500);
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
      const top = clamp(rect.top - topOffset, 12, window.innerHeight - 80);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }

    function hideChip() {
      if (chipEl) {
        chipEl.style.display = 'none';
      }
    }

    function hidePopover() {
      if (popoverAutoCloseTimer) {
        clearTimeout(popoverAutoCloseTimer);
        popoverAutoCloseTimer = null;
      }
      if (popoverEl) {
        popoverEl.style.display = 'none';
      }
    }

    function schedulePopoverClose(delayMs) {
      if (popoverAutoCloseTimer) {
        clearTimeout(popoverAutoCloseTimer);
      }

      popoverAutoCloseTimer = setTimeout(() => {
        popoverAutoCloseTimer = null;
        hidePopover();
      }, Math.max(200, Number(delayMs) || 900));
    }

    function showCopyFeedback(message, isError) {
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

    async function handleCopyAction(text, label) {
      if (!text) {
        showCopyFeedback(`${label}이 없습니다.`, true);
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
        showCopyFeedback(`${label}이 복사되었습니다.`, false);
        schedulePopoverClose(700);
      } catch (_) {
        showCopyFeedback('복사에 실패했습니다.', true);
      }
    }

    function readWindowSelection(anchor) {
      const selection = window.getSelection();
      const text = selection ? normalizeSelectionText(selection.toString()) : '';
      if (!selection || selection.rangeCount === 0 || !isSupportedSelectionLength(text)) {
        return null;
      }

      const range = selection.getRangeAt(0);
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

      const selected = readSelection(target, anchor);
      if (!selected) {
        hideChip();
        return;
      }

      ensureUi();
      chipEl.style.display = 'block';
      positionElement(chipEl, selected.rect, 42, anchor);
    }

    function renderPopover(text, translation, isLoading, errorMessage) {
      if (!popoverEl) {
        return;
      }

      const hasTranslation = Boolean(!isLoading && !errorMessage && translation);
      const secondaryButtonStyle = [
        'flex:1',
        'border-radius:10px',
        'padding:9px 10px',
        'cursor:pointer'
      ];
      const translationButtonStyle = [
        ...secondaryButtonStyle,
        hasTranslation
          ? 'border:1px solid rgba(255,255,255,0.12)'
          : 'border:1px solid rgba(255,255,255,0.08)',
        hasTranslation
          ? 'background:rgba(255,255,255,0.04)'
          : 'background:rgba(255,255,255,0.02)',
        hasTranslation ? 'color:#EDEEF0' : 'color:#667085',
        hasTranslation ? '' : 'cursor:not-allowed'
      ].filter(Boolean).join(';');

      popoverEl.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
          <div style="font-size:13px; font-weight:700;">선택 텍스트 번역</div>
          <button type="button" data-role="close" style="background:none; border:none; color:#A9AFB8; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="font-size:12px; color:#A9AFB8; margin-bottom:8px;">${escapeHtml(text)}</div>
        <div style="min-height:56px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.04); font-size:13px; line-height:1.6;">
          ${isLoading ? '번역 중...' : errorMessage ? escapeHtml(errorMessage) : escapeHtml(translation || '')}
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button type="button" data-role="copy-original" style="flex:1; border:none; border-radius:10px; padding:9px 10px; background:#2A6CF0; color:white; cursor:pointer;">원문 복사</button>
          <button type="button" data-role="copy-translation" ${hasTranslation ? '' : 'disabled'} style="${translationButtonStyle}">번역 복사</button>
        </div>
        <div data-role="copy-feedback" style="min-height:18px; margin-top:8px; font-size:12px; opacity:0; transition:opacity 0.16s ease;"></div>
      `;

      popoverEl.querySelector('[data-role="close"]')?.addEventListener('click', hidePopover);
      popoverEl.querySelector('[data-role="copy-original"]')?.addEventListener('click', async () => {
        await handleCopyAction(text, '원문');
      });
      popoverEl.querySelector('[data-role="copy-translation"]')?.addEventListener('click', async () => {
        await handleCopyAction(translation, '번역문');
      });
    }

    async function translateSelectionText(text, options) {
      ensureUi();
      renderPopover(text, '', true, '');
      popoverEl.style.display = 'block';
      positionElement(popoverEl, currentSelectionRect || { left: 12, top: 72, right: 12 }, -16, lastPointerAnchor);
      hideChip();

      try {
        const config = WPT.Provider && WPT.Provider.getActiveConfig
          ? await WPT.Provider.getActiveConfig()
          : null;
        const selectionMode = config && config.selectionTranslateMode === 'provider' ? 'provider' : 'fast';
        const requestProvider = selectionMode === 'provider'
          ? config.provider
          : (WPT.Provider && WPT.Provider.FAST_PAGE_PROVIDER ? WPT.Provider.FAST_PAGE_PROVIDER : 'builtin-fast');
        const requestModel = selectionMode === 'provider'
          ? config.model
          : (WPT.Provider && WPT.Provider.FAST_PAGE_MODEL ? WPT.Provider.FAST_PAGE_MODEL : 'google-web-mt');
        const requestApiKey = selectionMode === 'provider' ? config.apiKey : '';

        if (!config || (selectionMode === 'provider' && !config.hasApiKey)) {
          throw new Error('활성 프로바이더 API Key가 필요합니다.');
        }

        const translation = WPT.Provider && WPT.Provider.translateSelection
          ? await WPT.Provider.translateSelection({
            provider: requestProvider,
            apiKey: requestApiKey,
            model: requestModel,
            text
          })
          : '';

        renderPopover(text, translation, false, '');
        popoverEl.style.display = 'block';
        positionElement(popoverEl, currentSelectionRect || { left: 12, top: 72, right: 12 }, -16, lastPointerAnchor);
        void options;
        return translation;
      } catch (error) {
        renderPopover(text, '', false, error && error.message ? error.message : '선택 텍스트 번역 실패');
        popoverEl.style.display = 'block';
        positionElement(popoverEl, currentSelectionRect || { left: 12, top: 72, right: 12 }, -16, lastPointerAnchor);
        throw error;
      }
    }

    async function translateCurrentSelection(options) {
      const text = currentSelectionText || (readSelection(document.activeElement) && currentSelectionText);
      if (!text) {
        return;
      }
      return await translateSelectionText(text, options || {});
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
      if (chipEl && chipEl.contains(target)) {
        return;
      }
      if (popoverEl && popoverEl.contains(target)) {
        return;
      }
      if (!(target instanceof Node) || !window.getSelection || !window.getSelection()?.toString()) {
        hideChip();
      }
    }

    async function init() {
      if (initialized) {
        return;
      }
      initialized = true;
      await syncEnabled();
      ensureUi();

      document.addEventListener('mouseup', handlePointerUp, true);
      document.addEventListener('keyup', handlePointerUp, true);
      document.addEventListener('selectionchange', handleSelectionChange, true);
      document.addEventListener('scroll', hideChip, true);
      document.addEventListener('click', handleDocumentClick, true);

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, 'selectionTranslateEnabled')) {
          enabled = changes.selectionTranslateEnabled.newValue !== false;
          if (!enabled) {
            hideChip();
            hidePopover();
          }
        }
      });
    }

    WPT.Selection = {
      init,
      translateSelectionText,
      translateCurrentSelection,
      hideChip,
      hidePopover
    };

    void init();
  } catch (_) {
    // no-op
  }
})();
