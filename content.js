/**
 * Content Script - Multi-Provider Translation V2
 *
 * 역할:
 * - 우선순위 기반 페이지 번역 오케스트레이션
 * - progress v2 상태 푸시
 * - 선택 텍스트 번역/원본 복원
 */

if (typeof window.__WPT_INITIALIZED !== 'undefined') {
  console.log('[WPT] Content script already initialized, skipping reinit');
} else {
  window.__WPT_INITIALIZED = true;
  const CONTENT_RUNTIME_VERSION = '2026-03-12-content-v3';
  window.__WPT_CONTENT_RUNTIME_VERSION = CONTENT_RUNTIME_VERSION;

  let port = null;
  let activeRun = null;
  let originalTexts = new WeakMap();
  let translatedElements = new Set();

  window.WPT = window.WPT || {};
  const WPT = window.WPT;
  const CONST = WPT.Constants || {
    PORT_NAMES: { PANEL: 'panel' },
    PORT_MESSAGES: { PROGRESS: 'progress', CANCEL_TRANSLATION: 'CANCEL_TRANSLATION' },
    ACTIONS: {
      PING: 'PING',
      START_PAGE_TRANSLATION: 'START_PAGE_TRANSLATION',
      START_PRECISE_RETRANSLATION: 'START_PRECISE_RETRANSLATION',
      RESTORE_PAGE_ORIGINAL: 'RESTORE_PAGE_ORIGINAL',
      TRANSLATE_SELECTION: 'TRANSLATE_SELECTION',
      COPY_SELECTION: 'COPY_SELECTION',
      EXPLAIN_SELECTION: 'EXPLAIN_SELECTION',
      SEARCH_SELECTION: 'SEARCH_SELECTION',
      GET_PROGRESS_V2: 'GET_PROGRESS_V2',
      OPEN_QUICK_TRANSLATE_PANEL: 'OPEN_QUICK_TRANSLATE_PANEL',
      TRANSLATE_FULL_PAGE: 'translateFullPage',
      RESTORE_ORIGINAL: 'restoreOriginal',
      GET_TRANSLATION_STATE: 'getTranslationState',
      GET_TRANSLATED_TITLE: 'getTranslatedTitle',
      GET_CACHE_STATUS: 'getCacheStatus',
      CLEAR_CACHE_FOR_DOMAIN: 'clearCacheForDomain'
    },
    STORAGE_KEYS: {
      PENDING_QUICK_TRANSLATE: 'pendingQuickTranslate'
    },
    SELECTION_ACTIONS: [
      { key: 'translate', label: '번역', tone: 'primary', messageAction: 'TRANSLATE_SELECTION' },
      { key: 'copy', label: '복사', tone: 'secondary', messageAction: 'COPY_SELECTION' },
      { key: 'explain', label: '설명하기', tone: 'secondary', messageAction: 'EXPLAIN_SELECTION' },
      { key: 'search', label: '검색', tone: 'secondary', messageAction: 'SEARCH_SELECTION' }
    ],
    SELECTION_SEARCH_TARGETS: [
      { key: 'google', label: 'Google' },
      { key: 'naver', label: 'Naver' },
      { key: 'bing', label: 'Bing' },
      { key: 'chatgpt', label: 'ChatGPT' },
      { key: 'perplexity', label: 'Perplexity' },
      { key: 'all', label: '전체 검색' }
    ]
  };

  const PROFILE_CONFIG = {
    fast: { requestBudget: 900, parallelRequests: 4, readStringCache: true, readSnapshotCache: true },
    precise: { requestBudget: 700, parallelRequests: 2, readStringCache: false, readSnapshotCache: false }
  };
  const MAX_BATCH_SPLIT_DEPTH = 6;

  const LEVEL_MAP = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
  let currentLogLevel = 'INFO';

  /** @type {any} */
  let progressStatus = createDefaultProgressStatus();

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

  function createDefaultProgressStatus() {
    return {
      state: 'inactive',
      phase: 'idle',
      priority: 0,
      totalSegments: 0,
      visibleSegments: 0,
      translatedSegments: 0,
      totalTexts: 0,
      translatedCount: 0,
      cachedCount: 0,
      cacheHits: 0,
      batchCount: 0,
      batchesDone: 0,
      batches: [],
      activeRequests: 0,
      etaMs: 0,
      activeMs: 0,
      provider: '',
      model: '',
      profile: 'fast',
      originalTitle: '',
      translatedTitle: '',
      previewText: ''
    };
  }

  function maskSensitive(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const masked = Object.assign({}, data);
    if (masked.apiKey) {
      masked.apiKey = `${String(masked.apiKey).slice(0, 8)}***`;
    }
    return masked;
  }

  function log(level, evt, msg = '', data = {}, err = null) {
    if (level === 'DEBUG' && LEVEL_MAP[level] < LEVEL_MAP[currentLogLevel]) {
      return;
    }

    const record = Object.assign({
      ts: new Date().toISOString(),
      level,
      ns: 'content',
      evt,
      msg
    }, maskSensitive(data));

    if (err) {
      record.err = err instanceof Error ? err.message : String(err);
      if (typeof err?.status === 'number' && !Number.isNaN(err.status)) {
        record.errStatus = err.status;
      }
      if (typeof err?.provider === 'string' && err.provider) {
        record.errProvider = err.provider;
      }
      if (typeof err?.retryable === 'boolean') {
        record.errRetryable = err.retryable;
      }
    }

    const method = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
    console[method](`[WPT][${level}][content] ${evt}`, record);
  }

  const logDebug = (evt, msg, data, err) => log('DEBUG', evt, msg, data, err);
  const logInfo = (evt, msg, data, err) => log('INFO', evt, msg, data, err);
  const logError = (evt, msg, data, err) => log('ERROR', evt, msg, data, err);

  if (!WPT.Progress) {
    WPT.Progress = {
      setPort() {},
      clearPort() {},
      setStatusGetter() {},
      startTimer() {},
      stopTimer() {},
      reset() {},
      onBatchStart() {},
      onBatchEnd() {},
      pushProgress() {},
      getActiveMs() { return 0; }
    };
  }

  WPT.Progress.setStatusGetter(() => progressStatus);

  if (WPT.Dom && WPT.Dom.setEnv) {
    WPT.Dom.setEnv({
      getProgressStatus: () => progressStatus,
      originalTextsRef: originalTexts,
      translatedElementsRef: translatedElements,
      capturePreview: capturePreviewFromTranslation,
      setCachedTranslations: WPT.Cache && WPT.Cache.setCachedTranslations ? WPT.Cache.setCachedTranslations : null,
      progressPush: () => {
        recalculateEta();
        WPT.Progress.pushProgress();
      },
      logDebug: (evt, msg, data) => logDebug(evt, msg, data)
    });
  }

  chrome.runtime.onConnect.addListener((connectedPort) => {
    if (connectedPort.name !== CONST.PORT_NAMES.PANEL) {
      return;
    }

    port = connectedPort;
    WPT.Progress.setPort(port);
    WPT.Progress.pushProgress();

    port.onMessage.addListener((message) => {
      if (message.type === CONST.PORT_MESSAGES.CANCEL_TRANSLATION && activeRun) {
        cancelRun(activeRun, 'panel_cancelled');
      }
    });

    port.onDisconnect.addListener(() => {
      WPT.Progress.clearPort();
      port = null;
    });
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === CONST.ACTIONS.PING) {
      sendResponse({ ok: true, version: CONTENT_RUNTIME_VERSION });
      return true;
    }

    if (request.action === CONST.ACTIONS.START_PAGE_TRANSLATION || request.action === CONST.ACTIONS.TRANSLATE_FULL_PAGE) {
      const profile = request.profile || (request.useCache === false ? 'precise' : 'fast');
      void handleStartTranslation({
        provider: request.provider,
        apiKey: request.apiKey,
        model: request.model,
        profile
      });
      sendResponse({ success: true });
      return true;
    }

    if (request.action === CONST.ACTIONS.START_PRECISE_RETRANSLATION) {
      void handleStartTranslation({
        provider: request.provider,
        apiKey: request.apiKey,
        model: request.model,
        profile: 'precise'
      });
      sendResponse({ success: true });
      return true;
    }

    if (request.action === CONST.ACTIONS.RESTORE_PAGE_ORIGINAL || request.action === CONST.ACTIONS.RESTORE_ORIGINAL) {
      handleRestoreOriginal();
      sendResponse({ success: true });
      return true;
    }

    if (request.action === CONST.ACTIONS.GET_PROGRESS_V2 || request.action === CONST.ACTIONS.GET_TRANSLATION_STATE) {
      sendResponse(progressStatus);
      return true;
    }

    if (request.action === CONST.ACTIONS.GET_TRANSLATED_TITLE) {
      sendResponse({ title: document.title });
      return true;
    }

    if (request.action === CONST.ACTIONS.GET_CACHE_STATUS) {
      (WPT.Cache && WPT.Cache.getCacheStatus ? WPT.Cache.getCacheStatus() : Promise.resolve({ success: false, count: 0, size: 0 }))
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, count: 0, size: 0, error: error.message }));
      return true;
    }

    if (request.action === CONST.ACTIONS.CLEAR_CACHE_FOR_DOMAIN) {
      (WPT.Cache && WPT.Cache.handleClearCacheForDomain ? WPT.Cache.handleClearCacheForDomain() : Promise.resolve({ success: false, error: 'not_supported' }))
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === CONST.ACTIONS.TRANSLATE_SELECTION) {
      (WPT.Selection && WPT.Selection.translateSelectionText
        ? WPT.Selection.translateSelectionText(request.text || '', { source: 'message' })
        : Promise.reject(new Error('selection_not_ready')))
        .then((translation) => sendResponse({ success: true, translation }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === CONST.ACTIONS.COPY_SELECTION) {
      (WPT.Selection && WPT.Selection.copySelectionText
        ? WPT.Selection.copySelectionText(request.text || '', { source: 'message', showFeedback: false })
        : Promise.reject(new Error('selection_not_ready')))
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === CONST.ACTIONS.EXPLAIN_SELECTION) {
      (WPT.Selection && WPT.Selection.explainSelectionText
        ? WPT.Selection.explainSelectionText(request.text || '', { source: 'message' })
        : Promise.reject(new Error('selection_not_ready')))
        .then((explanation) => sendResponse({ success: true, explanation }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
    }

    if (request.action === 'GEO_GET_SELECTORS') {
      handleGeoSelectorsRequest(request, sendResponse);
      return true;
    }

    if (request.action === 'GET_CURRENT_HTML') {
      sendResponse({ html: document.documentElement.outerHTML });
      return true;
    }

    return false;
  });

  async function handleGeoSelectorsRequest(request, sendResponse) {
    try {
      const selectors = request.selectors || [];
      const results = [];
      for (const selectorDef of selectors) {
        try {
          const selectorFunc = eval(`(${selectorDef.selectorCode})`);
          results.push({ id: selectorDef.id, value: selectorFunc() });
        } catch (error) {
          results.push({ id: selectorDef.id, value: null, error: error.message });
        }
      }
      sendResponse({ data: results });
    } catch (error) {
      sendResponse({ error: error.message });
    }
  }

  function capturePreviewFromTranslation(translation) {
    if (progressStatus.previewText) {
      return;
    }
    if (typeof translation !== 'string') {
      return;
    }
    const normalized = translation.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return;
    }
    progressStatus.previewText = normalized.slice(0, 120);
  }

  function recalculateEta() {
    const translated = progressStatus.translatedSegments || 0;
    const total = progressStatus.totalSegments || 0;
    const activeMs = WPT.Progress.getActiveMs ? Math.round(WPT.Progress.getActiveMs()) : progressStatus.activeMs || 0;
    progressStatus.activeMs = activeMs;

    if (!translated || translated >= total || activeMs <= 0) {
      progressStatus.etaMs = 0;
      return;
    }

    const rate = translated / activeMs;
    progressStatus.etaMs = rate > 0 ? Math.round((total - translated) / rate) : 0;
  }

  function resetState(config) {
    progressStatus = Object.assign(createDefaultProgressStatus(), {
      state: 'analyzing',
      phase: 'analyzing',
      provider: config.provider,
      model: config.model,
      profile: config.profile,
      originalTitle: (document.title || '').trim(),
      translatedTitle: (document.title || '').trim()
    });
    WPT.Progress.reset();
    WPT.Progress.pushProgress();
  }

  function createRunToken() {
    return {
      cancelled: false,
      id: Date.now() + Math.random(),
      controller: typeof AbortController === 'function' ? new AbortController() : null
    };
  }

  function isRunCurrent(runToken) {
    return Boolean(runToken && activeRun === runToken && !runToken.cancelled);
  }

  function cancelRun(runToken, reason) {
    if (!runToken || runToken.cancelled) {
      return;
    }

    runToken.cancelled = true;
    if (runToken.controller) {
      try {
        runToken.controller.abort(reason || 'translation_cancelled');
      } catch (_) {
        // no-op
      }
    }
  }

  async function resolveTranslationConfig(partialConfig) {
    const requestedProfile = partialConfig && partialConfig.profile === 'precise' ? 'precise' : 'fast';
    if (requestedProfile === 'fast') {
      return {
        provider: WPT.Provider && WPT.Provider.FAST_PAGE_PROVIDER ? WPT.Provider.FAST_PAGE_PROVIDER : 'builtin-fast',
        apiKey: '',
        model: WPT.Provider && WPT.Provider.FAST_PAGE_MODEL ? WPT.Provider.FAST_PAGE_MODEL : 'google-web-mt',
        profile: 'fast',
        pipelineVersion: WPT.Provider && WPT.Provider.PIPELINE_VERSION ? WPT.Provider.PIPELINE_VERSION : 'v2'
      };
    }

    if (partialConfig && partialConfig.provider && partialConfig.apiKey && partialConfig.model) {
      return {
        provider: partialConfig.provider,
        apiKey: partialConfig.apiKey,
        model: partialConfig.model,
        profile: 'precise',
        pipelineVersion: WPT.Provider && WPT.Provider.PIPELINE_VERSION ? WPT.Provider.PIPELINE_VERSION : 'v2'
      };
    }

    if (WPT.Provider && WPT.Provider.getActiveConfig) {
      const config = await WPT.Provider.getActiveConfig();
      return {
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        profile: 'precise',
        pipelineVersion: config.translationPipelineVersion || 'v2'
      };
    }

    throw new Error('provider_not_ready');
  }

  function sumTargetCount(segments) {
    return (segments || []).reduce((sum, segment) => sum + Math.max(1, (segment.targets || []).length), 0);
  }

  function addBatchEntry(size, priority, source) {
    progressStatus.batches.push({
      size,
      priority,
      source,
      status: 'pending'
    });
    progressStatus.batchCount = progressStatus.batches.length;
    return progressStatus.batches.length - 1;
  }

  function updateBatchEntry(batchIndex, status) {
    if (!progressStatus.batches[batchIndex]) {
      return;
    }
    progressStatus.batches[batchIndex].status = status;
    if (status === 'completed' || status === 'failed') {
      progressStatus.batchesDone += 1;
    }
  }

  function buildRequestBatches(segments, requestBudget) {
    const batches = [];
    let current = [];
    let tokenBudget = 0;

    (segments || []).forEach((segment) => {
      const estimate = estimateSegmentTokens(segment);
      const wouldOverflow = current.length >= 60 || (current.length > 0 && tokenBudget + estimate > requestBudget);
      if (wouldOverflow) {
        batches.push(current);
        current = [];
        tokenBudget = 0;
      }
      current.push(segment);
      tokenBudget += estimate;
    });

    if (current.length > 0) {
      batches.push(current);
    }

    return batches;
  }

  function estimateSegmentTokens(segment) {
    return Math.max(1, Math.ceil(String(segment?.serializedText || segment?.text || '').length / 4));
  }

  function splitBatchForRetry(segments) {
    if (!Array.isArray(segments) || segments.length <= 1) {
      return [segments || []];
    }

    const totalTokens = segments.reduce((sum, segment) => sum + estimateSegmentTokens(segment), 0);
    let runningTokens = 0;
    let splitIndex = 1;

    for (let index = 0; index < segments.length; index += 1) {
      runningTokens += estimateSegmentTokens(segments[index]);
      if (index > 0 && runningTokens >= totalTokens / 2) {
        splitIndex = index + 1;
        break;
      }
    }

    splitIndex = Math.min(Math.max(splitIndex, 1), segments.length - 1);
    return [segments.slice(0, splitIndex), segments.slice(splitIndex)];
  }

  function getRuntimeProfileConfig(config) {
    const base = PROFILE_CONFIG[config.profile] || PROFILE_CONFIG.fast;
    if (!config || config.profile !== 'precise') {
      return base;
    }

    const provider = String(config.provider || '').toLowerCase();
    const model = String(config.model || '').toLowerCase();

    if (provider === 'openrouter' && model.startsWith('openai/gpt-5')) {
      return Object.assign({}, base, {
        requestBudget: Math.min(base.requestBudget, 320),
        parallelRequests: 1
      });
    }

    return base;
  }

  function isMissingTranslation(value) {
    return typeof value !== 'string' || !value.trim();
  }

  async function requestTranslationsWithFallback(segments, config, runToken, purpose, splitDepth = 0, allowMissingRecovery = true) {
    try {
      const initialTranslations = await WPT.Provider.translateSegments({
        provider: config.provider,
        apiKey: config.apiKey,
        model: config.model,
        profile: config.profile,
        purpose,
        signal: config.signal,
        segments: segments.map((segment) => ({
          text: segment.serializedText,
          role: segment.role
        }))
      });

      return allowMissingRecovery
        ? await recoverMissingTranslations(segments, initialTranslations, config, runToken, splitDepth)
        : initialTranslations;
    } catch (error) {
      const isAbortError = Boolean(WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error));
      if (isAbortError || !isRunCurrent(runToken)) {
        throw error;
      }

      if (!Array.isArray(segments) || segments.length <= 1 || splitDepth >= MAX_BATCH_SPLIT_DEPTH) {
        throw error;
      }

      const splitBatches = splitBatchForRetry(segments).filter((batch) => Array.isArray(batch) && batch.length > 0);
      if (splitBatches.length <= 1) {
        throw error;
      }

      logInfo('BATCH_SPLIT_RETRY', '배치 실패로 재분할 재시도', {
        provider: config.provider,
        model: config.model,
        purpose,
        splitDepth,
        originalCount: segments.length,
        retryCounts: splitBatches.map((batch) => batch.length)
      }, error);

      const translations = [];
      for (const batch of splitBatches) {
        if (!isRunCurrent(runToken)) {
          return translations;
        }
        const partial = await requestTranslationsWithFallback(
          batch,
          config,
          runToken,
          purpose,
          splitDepth + 1,
          allowMissingRecovery
        );
        translations.push(...partial);
      }

      return translations;
    }
  }

  async function recoverMissingTranslations(segments, translations, config, runToken, splitDepth = 0) {
    if (config.profile !== 'precise' || !Array.isArray(translations) || !Array.isArray(segments)) {
      return translations;
    }

    const recoveredTranslations = [...translations];
    const missingIndexes = recoveredTranslations
      .map((translation, index) => (isMissingTranslation(translation) ? index : -1))
      .filter((index) => index >= 0);

    if (missingIndexes.length === 0 || !isRunCurrent(runToken)) {
      return recoveredTranslations;
    }

    for (let cursor = 0; cursor < missingIndexes.length; cursor += 6) {
      if (!isRunCurrent(runToken)) {
        return recoveredTranslations;
      }

      const indexGroup = missingIndexes.slice(cursor, cursor + 6);
      const recoverySegments = indexGroup.map((index) => segments[index]);

      try {
        const retriedTranslations = await requestTranslationsWithFallback(
          recoverySegments,
          config,
          runToken,
          'page-precise-recovery',
          splitDepth + 1,
          false
        );

        retriedTranslations.forEach((translation, index) => {
          if (!isMissingTranslation(translation)) {
            recoveredTranslations[indexGroup[index]] = translation;
          }
        });
      } catch (error) {
        const isAbortError = Boolean(WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error));
        if (isAbortError || !isRunCurrent(runToken)) {
          return recoveredTranslations;
        }

        logError('MISSING_TRANSLATION_RECOVERY_FAILED', '누락 세그먼트 재번역 실패', {
          missingCount: indexGroup.length,
          provider: config.provider,
          model: config.model
        }, error);
      }
    }

    return recoveredTranslations;
  }

  async function applySegmentChunk(segments, translations, config, options) {
    if (!segments.length) {
      return;
    }

    if (options && options.runToken && !isRunCurrent(options.runToken)) {
      return;
    }

    await WPT.Dom.applyTranslationsToDom(
      { segments, translations },
      {
        writeCache: options.writeCache !== false,
        provider: config.provider,
        model: config.model,
        profile: config.profile,
        pipelineVersion: config.pipelineVersion,
        shouldApply: options && options.runToken ? () => isRunCurrent(options.runToken) : null
      }
    );

    if (options && options.runToken && !isRunCurrent(options.runToken)) {
      return;
    }

    const hits = options.cached === true ? sumTargetCount(segments) : 0;
    if (hits > 0) {
      progressStatus.cachedCount += hits;
      progressStatus.cacheHits = progressStatus.cachedCount;
    }

    recalculateEta();
    WPT.Progress.pushProgress();
  }

  async function applyCachedPrioritySegments(priority, cachedEntries, config, runToken) {
    const chunks = [];
    for (let index = 0; index < cachedEntries.length; index += 24) {
      chunks.push(cachedEntries.slice(index, index + 24));
    }

    for (const chunk of chunks) {
      if (!isRunCurrent(runToken)) {
        return;
      }

      const segments = chunk.map((entry) => entry.segment);
      const translations = chunk.map((entry) => entry.translation);
      const batchIndex = addBatchEntry(sumTargetCount(segments), priority, 'cache');
      updateBatchEntry(batchIndex, 'processing');
      WPT.Progress.pushProgress();
      await applySegmentChunk(segments, translations, config, {
        cached: true,
        writeCache: false,
        runToken
      });
      if (!isRunCurrent(runToken)) {
        return;
      }
      updateBatchEntry(batchIndex, 'completed');
      WPT.Progress.pushProgress();
    }
  }

  async function translatePrioritySegments(priority, uncachedSegments, config, resolvedTranslations, runToken) {
    if (!uncachedSegments.length || !isRunCurrent(runToken)) {
      return;
    }

    const profileConfig = getRuntimeProfileConfig(config);
    const requestBatches = buildRequestBatches(uncachedSegments, profileConfig.requestBudget);
    const domApplyQueue = { current: Promise.resolve() };
    let cursor = 0;

    const batchIndexes = requestBatches.map((segments) => addBatchEntry(sumTargetCount(segments), priority, 'network'));
    WPT.Progress.pushProgress();

    const worker = async () => {
      while (cursor < requestBatches.length) {
        const localIndex = cursor;
        cursor += 1;
        const segments = requestBatches[localIndex];
        const batchIndex = batchIndexes[localIndex];

        if (!segments || !isRunCurrent(runToken)) {
          return;
        }

        updateBatchEntry(batchIndex, 'processing');
        WPT.Progress.onBatchStart();
        WPT.Progress.pushProgress();

        try {
          const batchPurpose = config.profile === 'precise'
            ? (priority === 1 ? 'page-precise-visible' : 'page-precise-full')
            : (priority === 1 ? 'priority-visible' : 'priority-full');
          const translations = await requestTranslationsWithFallback(
            segments,
            config,
            runToken,
            batchPurpose
          );

          if (!isRunCurrent(runToken)) {
            return;
          }

          translations.forEach((translation, index) => {
            if (translation) {
              resolvedTranslations.set(segments[index].normalizedText, translation);
            }
          });

          domApplyQueue.current = domApplyQueue.current.then(async () => {
            if (!isRunCurrent(runToken)) {
              return;
            }
            await applySegmentChunk(segments, translations, config, {
              cached: false,
              writeCache: true,
              runToken
            });
          });
          await domApplyQueue.current;
          if (!isRunCurrent(runToken)) {
            return;
          }
          updateBatchEntry(batchIndex, 'completed');
        } catch (error) {
          const isAbortError = Boolean(WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error));
          if (!isRunCurrent(runToken) || isAbortError) {
            return;
          }
          updateBatchEntry(batchIndex, 'failed');
          logError('BATCH_TRANSLATION_FAILED', '배치 번역 실패', {
            priority,
            batchIndex,
            count: segments.length
          }, error);
        } finally {
          WPT.Progress.onBatchEnd();
          if (isRunCurrent(runToken)) {
            WPT.Progress.pushProgress();
          }
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(profileConfig.parallelRequests, requestBatches.length) },
      () => worker()
    );
    await Promise.all(workers);
    await domApplyQueue.current;
  }

  async function processPriority(priority, segments, translationConfig, cachedMap, resolvedTranslations, runToken) {
    if (!segments.length || !isRunCurrent(runToken)) {
      return;
    }

    progressStatus.state = 'translating';
    progressStatus.priority = priority;
    progressStatus.phase = priority === 1 ? 'analyzing' : 'full';
    WPT.Progress.pushProgress();

    const cachedEntries = [];
    const uncachedSegments = [];

    segments.forEach((segment) => {
      const cached = cachedMap.get(segment.normalizedText) || null;
      if (cached) {
        resolvedTranslations.set(segment.normalizedText, cached);
        cachedEntries.push({ segment, translation: cached });
      } else {
        uncachedSegments.push(segment);
      }
    });

    await applyCachedPrioritySegments(priority, cachedEntries, translationConfig, runToken);
    if (!isRunCurrent(runToken)) {
      return;
    }

    if (translationConfig.profile === 'precise' && priority > 1 && uncachedSegments.length > 0 && WPT.Industry && WPT.Industry.ensureIndustryContext) {
      const hasContext = typeof WPT.Industry.hasContext === 'function' ? WPT.Industry.hasContext() : false;
      if (!hasContext) {
        await WPT.Industry.ensureIndustryContext(
          uncachedSegments.map((segment) => segment.plainText),
          translationConfig.provider,
          translationConfig.apiKey,
          translationConfig.model,
          translationConfig.signal
        );
        if (!isRunCurrent(runToken)) {
          return;
        }
      }
    }

    await translatePrioritySegments(priority, uncachedSegments, translationConfig, resolvedTranslations, runToken);

    if (priority === 1 && isRunCurrent(runToken)) {
      progressStatus.phase = 'visible';
      WPT.Progress.pushProgress();
    }
  }

  async function applySnapshot(snapshot, segments, config, resolvedTranslations, runToken) {
    const translationByKey = new Map((snapshot && snapshot.segments ? snapshot.segments : []).map((item) => [item.key, item.translation]));
    const renderChunks = [];
    let currentChunk = [];

    segments.forEach((segment) => {
      const translation = translationByKey.get(segment.normalizedText) || null;
      if (!translation) {
        return;
      }
      resolvedTranslations.set(segment.normalizedText, translation);
      currentChunk.push({ segment, translation });
      if (currentChunk.length >= 24) {
        renderChunks.push(currentChunk);
        currentChunk = [];
      }
    });

    if (currentChunk.length > 0) {
      renderChunks.push(currentChunk);
    }

    for (const chunk of renderChunks) {
      if (!isRunCurrent(runToken)) {
        return;
      }
      const priority = Math.min(...chunk.map((entry) => entry.segment.priority));
      const batchIndex = addBatchEntry(sumTargetCount(chunk.map((entry) => entry.segment)), priority, 'snapshot');
      updateBatchEntry(batchIndex, 'processing');
      await applySegmentChunk(
        chunk.map((entry) => entry.segment),
        chunk.map((entry) => entry.translation),
        config,
        { cached: true, writeCache: false, runToken }
      );
      if (!isRunCurrent(runToken)) {
        return;
      }
      updateBatchEntry(batchIndex, 'completed');
      WPT.Progress.pushProgress();
    }
  }

  async function handleStartTranslation(partialConfig) {
    if (activeRun && !activeRun.cancelled && progressStatus.state === 'translating') {
      return;
    }

    const translationConfig = await resolveTranslationConfig(partialConfig || {});
    const runToken = createRunToken();
    activeRun = runToken;
    translationConfig.signal = runToken.controller ? runToken.controller.signal : undefined;
    originalTexts = new WeakMap();
    translatedElements = new Set();

    if (WPT.Dom && WPT.Dom.setEnv) {
      WPT.Dom.setEnv({
        getProgressStatus: () => progressStatus,
        originalTextsRef: originalTexts,
        translatedElementsRef: translatedElements,
        capturePreview: capturePreviewFromTranslation,
        setCachedTranslations: WPT.Cache && WPT.Cache.setCachedTranslations ? WPT.Cache.setCachedTranslations : null,
        progressPush: () => {
          recalculateEta();
          WPT.Progress.pushProgress();
        },
        logDebug: (evt, msg, data) => logDebug(evt, msg, data)
      });
    }

    resetState(translationConfig);
    if (WPT.Industry && WPT.Industry.reset) {
      WPT.Industry.reset();
    }

    try {
      const analysis = WPT.Dom && WPT.Dom.analyzePageSegments ? WPT.Dom.analyzePageSegments() : { segments: [], visibleSegments: 0, domSignature: '' };
      const segments = analysis.segments || [];
      const totalRenderableSegments = sumTargetCount(segments);
      const visibleRenderableSegments = sumTargetCount(segments.filter((segment) => segment.priority === 1));
      const cacheContext = {
        provider: translationConfig.provider,
        model: translationConfig.model,
        profile: translationConfig.profile,
        pipelineVersion: translationConfig.pipelineVersion
      };
      const resolvedTranslations = new Map();

      progressStatus.totalSegments = totalRenderableSegments;
      progressStatus.totalTexts = totalRenderableSegments;
      progressStatus.visibleSegments = visibleRenderableSegments || totalRenderableSegments;
      progressStatus.originalTitle = (document.title || '').trim();
      progressStatus.translatedTitle = (document.title || '').trim();
      WPT.Progress.pushProgress();

      if (translationConfig.profile === 'precise' && WPT.Industry && WPT.Industry.ensureIndustryContext) {
        const seedTexts = segments
          .filter((segment) => segment.priority <= 2)
          .slice(0, 18)
          .map((segment) => segment.plainText)
          .filter(Boolean);
        if (seedTexts.length > 0) {
          await WPT.Industry.ensureIndustryContext(
            seedTexts,
            translationConfig.provider,
            translationConfig.apiKey,
            translationConfig.model,
            translationConfig.signal
          );
          if (!isRunCurrent(runToken)) {
            return;
          }
        }
      }

      const titlePromise = WPT.Title && WPT.Title.translateDocumentTitle
        ? WPT.Title.translateDocumentTitle(translationConfig, translationConfig.profile !== 'precise', progressStatus.originalTitle, () => progressStatus)
        : Promise.resolve();

      if (segments.length === 0) {
        if (!isRunCurrent(runToken)) {
          return;
        }
        progressStatus.state = 'completed';
        progressStatus.phase = 'completed';
        await titlePromise.catch(() => {});
        if (!isRunCurrent(runToken)) {
          return;
        }
        WPT.Progress.pushProgress();
        return;
      }

      const profileConfig = PROFILE_CONFIG[translationConfig.profile] || PROFILE_CONFIG.fast;
      if (profileConfig.readSnapshotCache && WPT.Cache && WPT.Cache.getPageSnapshot) {
        const snapshot = await WPT.Cache.getPageSnapshot(window.location.href, analysis.domSignature, cacheContext);
        if (!isRunCurrent(runToken)) {
          return;
        }
        if (snapshot && Array.isArray(snapshot.segments) && snapshot.segments.length > 0) {
          await applySnapshot(snapshot, segments, translationConfig, resolvedTranslations, runToken);
          if (!isRunCurrent(runToken)) {
            return;
          }
          progressStatus.phase = 'completed';
          progressStatus.state = 'completed';
          await titlePromise.catch(() => {});
          if (!isRunCurrent(runToken)) {
            return;
          }
          recalculateEta();
          WPT.Progress.pushProgress();
          return;
        }
      }

      const cachedTranslations = profileConfig.readStringCache && WPT.Cache && WPT.Cache.getCachedTranslations
        ? await WPT.Cache.getCachedTranslations(segments.map((segment) => segment.normalizedText), cacheContext)
        : segments.map(() => null);
      if (!isRunCurrent(runToken)) {
        return;
      }

      const cachedMap = new Map();
      segments.forEach((segment, index) => {
        if (cachedTranslations[index]) {
          cachedMap.set(segment.normalizedText, cachedTranslations[index]);
        }
      });

      await processPriority(1, segments.filter((segment) => segment.priority === 1), translationConfig, cachedMap, resolvedTranslations, runToken);
      await processPriority(2, segments.filter((segment) => segment.priority === 2), translationConfig, cachedMap, resolvedTranslations, runToken);
      await processPriority(3, segments.filter((segment) => segment.priority === 3), translationConfig, cachedMap, resolvedTranslations, runToken);

      if (!isRunCurrent(runToken)) {
        return;
      }

      await titlePromise.catch(() => {});
      if (!isRunCurrent(runToken)) {
        return;
      }

      progressStatus.phase = 'completed';
      progressStatus.state = 'completed';
      recalculateEta();
      WPT.Progress.pushProgress();

      if (translationConfig.profile === 'fast' && WPT.Cache && WPT.Cache.setPageSnapshot && isRunCurrent(runToken)) {
        await WPT.Cache.setPageSnapshot(
          window.location.href,
          analysis.domSignature,
          {
            segments: segments.map((segment) => ({
              key: segment.normalizedText,
              translation: resolvedTranslations.get(segment.normalizedText) || null,
              priority: segment.priority
            }))
          },
          cacheContext
        );
      }

      if (!isRunCurrent(runToken)) {
        return;
      }

      logInfo('TRANSLATION_COMPLETED', '페이지 번역 완료', {
        provider: translationConfig.provider,
        model: translationConfig.model,
        profile: translationConfig.profile,
        totalSegments: progressStatus.totalSegments,
        translatedSegments: progressStatus.translatedSegments,
        cacheHits: progressStatus.cacheHits,
        batches: progressStatus.batchCount,
        activeMs: progressStatus.activeMs
      });
    } catch (error) {
      const isAbortError = Boolean(WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error));
      if (!isRunCurrent(runToken) || isAbortError) {
        return;
      }
      progressStatus.state = 'error';
      progressStatus.phase = 'full';
      WPT.Progress.pushProgress();
      logError('TRANSLATION_ERROR', '페이지 번역 실패', {
        provider: translationConfig.provider,
        model: translationConfig.model,
        profile: translationConfig.profile
      }, error);
    } finally {
      if (activeRun === runToken) {
        activeRun = null;
      }
    }
  }

  function handleRestoreOriginal() {
    translatedElements.forEach((node) => {
      if (node && originalTexts.has(node)) {
        node.textContent = originalTexts.get(node);
      }
    });

    originalTexts = new WeakMap();
    translatedElements = new Set();

    if (progressStatus.originalTitle && WPT.Title && WPT.Title.applyTranslatedTitleToDocument) {
      WPT.Title.applyTranslatedTitleToDocument(progressStatus.originalTitle, () => progressStatus);
    } else if (progressStatus.originalTitle) {
      document.title = progressStatus.originalTitle;
    }

    if (activeRun) {
      cancelRun(activeRun, 'user_restore');
      activeRun = null;
    }

    if (WPT.Dom && WPT.Dom.setEnv) {
      WPT.Dom.setEnv({
        getProgressStatus: () => progressStatus,
        originalTextsRef: originalTexts,
        translatedElementsRef: translatedElements,
        capturePreview: capturePreviewFromTranslation,
        setCachedTranslations: WPT.Cache && WPT.Cache.setCachedTranslations ? WPT.Cache.setCachedTranslations : null,
        progressPush: () => {
          recalculateEta();
          WPT.Progress.pushProgress();
        },
        logDebug: (evt, msg, data) => logDebug(evt, msg, data)
      });
    }

    WPT.Progress.reset();
    progressStatus.state = 'restored';
    progressStatus.phase = 'idle';
    progressStatus.priority = 0;
    progressStatus.totalSegments = 0;
    progressStatus.visibleSegments = 0;
    progressStatus.totalTexts = 0;
    progressStatus.translatedSegments = 0;
    progressStatus.translatedCount = 0;
    progressStatus.cachedCount = 0;
    progressStatus.cacheHits = 0;
    progressStatus.batchCount = 0;
    progressStatus.batchesDone = 0;
    progressStatus.batches = [];
    progressStatus.activeMs = 0;
    progressStatus.previewText = '';
    progressStatus.translatedTitle = progressStatus.originalTitle;
    progressStatus.activeRequests = 0;
    progressStatus.etaMs = 0;
    WPT.Progress.pushProgress();
  }
}
