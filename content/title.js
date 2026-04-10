/**
 * Content Title Module
 * - 제목 번역/적용 및 진행 갱신
 */
(function titleModule(){
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    function normalizeTranslatedTitle(titleText, originalTitle) {
      if (typeof titleText !== 'string') {
        return typeof originalTitle === 'string' ? originalTitle : '';
      }

      let normalized = titleText
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      normalized = normalized.replace(/^제목을?\s*한국어로\s*번역(?:하면)?(?:\s*다음과 같습니다)?\s*[:：]\s*/i, '');
      normalized = normalized.replace(/^번역\s*[:：]\s*/i, '');
      normalized = normalized.replace(/^["'`]+|["'`]+$/g, '').trim();

      if (!normalized) {
        return typeof originalTitle === 'string' ? originalTitle : '';
      }

      return normalized;
    }

    function applyTranslatedTitleToDocument(titleText, getProgressStatus){
      if (typeof titleText !== 'string') return;
      const normalized = titleText.trim();
      const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
      if (status) status.translatedTitle = normalized;
      if (!normalized) return;
      if (document.title !== normalized) document.title = normalized;
      const titleElement = document.querySelector('title');
      if (titleElement && titleElement.textContent !== normalized){ titleElement.textContent = normalized; }
    }

    function normalizeConfig(configOrApiKey, modelArg) {
      if (configOrApiKey && typeof configOrApiKey === 'object') {
        return {
          provider: configOrApiKey.provider || 'openrouter',
          apiKey: configOrApiKey.apiKey || '',
          model: configOrApiKey.model || modelArg || '',
          profile: configOrApiKey.profile || 'fast'
        };
      }

      return {
        provider: 'openrouter',
        apiKey: configOrApiKey || '',
        model: modelArg || '',
        profile: 'fast'
      };
    }

    async function translateDocumentTitle(configOrApiKey, modelOrUseCache, useCacheOrOriginalTitle, originalTitleOrStatus, maybeGetProgressStatus){
      let getProgressStatus = null;

      try{
        let config = null;
        let useCache = true;
        let originalTitle = '';

        if (configOrApiKey && typeof configOrApiKey === 'object') {
          config = normalizeConfig(configOrApiKey);
          useCache = Boolean(modelOrUseCache);
          originalTitle = typeof useCacheOrOriginalTitle === 'string' ? useCacheOrOriginalTitle : '';
          getProgressStatus = typeof originalTitleOrStatus === 'function' ? originalTitleOrStatus : maybeGetProgressStatus;
        } else {
          config = normalizeConfig(configOrApiKey, modelOrUseCache);
          useCache = Boolean(useCacheOrOriginalTitle);
          originalTitle = typeof originalTitleOrStatus === 'string' ? originalTitleOrStatus : '';
          getProgressStatus = maybeGetProgressStatus;
        }

        const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
        if (!originalTitle){ if (status){ status.originalTitle=''; status.translatedTitle=''; } return; }
        if (status){ status.originalTitle = originalTitle; status.translatedTitle = originalTitle; }

        if (useCache && WPT.Cache && WPT.Cache.getCachedTranslation){
          const cached = await WPT.Cache.getCachedTranslation(originalTitle, {
            provider: config.provider,
            model: config.model,
            profile: 'fast',
            kind: 'title'
          });
          if (cached && cached.trim().length > 0){
            applyTranslatedTitleToDocument(normalizeTranslatedTitle(cached.trim(), originalTitle), getProgressStatus);
            if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
            return;
          }
        }

        const translated = WPT.Provider && WPT.Provider.translateTitle
          ? await WPT.Provider.translateTitle({
            provider: config.provider,
            apiKey: config.apiKey,
            model: config.model,
            profile: config.profile,
            signal: config.signal,
            title: originalTitle
          })
          : '';
        const finalTitle = normalizeTranslatedTitle(translated, originalTitle);
        applyTranslatedTitleToDocument(finalTitle, getProgressStatus);
        if (useCache && WPT.Cache && WPT.Cache.setCachedTranslation && finalTitle !== originalTitle){
          await WPT.Cache.setCachedTranslation(originalTitle, finalTitle, config.model, {
            provider: config.provider,
            profile: 'fast',
            kind: 'title'
          });
        }
        if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
      }catch(error){
        if (WPT.Provider && WPT.Provider.isAbortError && WPT.Provider.isAbortError(error)) {
          return;
        }
        const status = typeof getProgressStatus === 'function' ? getProgressStatus() : null;
        if (status) applyTranslatedTitleToDocument(status.originalTitle || document.title || '', getProgressStatus);
        if (WPT.Progress && WPT.Progress.pushProgress) WPT.Progress.pushProgress();
      }
    }

    WPT.Title = { translateDocumentTitle, applyTranslatedTitleToDocument };
  } catch(_) { /* no-op */ }
})();

