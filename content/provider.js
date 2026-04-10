/**
 * Content Provider Module
 * - 멀티 프로바이더 번역/프롬프트 클라이언트
 */
(function providerModule() {
  try {
    window.WPT = window.WPT || {};
    const WPT = window.WPT;

    const DEFAULT_PROVIDER = 'openrouter';
    const DEFAULT_PROFILE = 'fast';
    const PIPELINE_VERSION = 'v2';
    const FAST_PAGE_PROVIDER = 'builtin-fast';
    const FAST_PAGE_MODEL = 'google-web-mt';
    const PROVIDER_CATALOG = {
      openrouter: {
        id: 'openrouter',
        label: 'OpenRouter',
        apiKeyStorageKey: 'openRouterApiKey',
        defaultModel: 'google/gemini-3.1-flash-lite-preview',
        models: [
          'google/gemini-3.1-flash-lite-preview',
          'openai/gpt-5-nano'
        ]
      },
      openai: {
        id: 'openai',
        label: 'OpenAI',
        apiKeyStorageKey: 'openAIApiKey',
        defaultModel: 'gpt-5-nano',
        models: [
          'gpt-5-nano'
        ]
      },
      gemini: {
        id: 'gemini',
        label: 'Gemini',
        apiKeyStorageKey: 'geminiApiKey',
        defaultModel: 'gemini-3.1-flash-lite-preview',
        models: [
          'gemini-3.1-flash-lite-preview'
        ]
      }
    };

    function getDefaultModelForProvider(providerId) {
      return (PROVIDER_CATALOG[providerId] || PROVIDER_CATALOG[DEFAULT_PROVIDER]).defaultModel;
    }

    function resolveModelForProvider(providerId, modelId) {
      const provider = PROVIDER_CATALOG[providerId] ? providerId : DEFAULT_PROVIDER;
      const catalog = PROVIDER_CATALOG[provider];
      const normalizedModel = typeof modelId === 'string' ? modelId.trim() : '';

      if (normalizedModel && Array.isArray(catalog.models) && catalog.models.includes(normalizedModel)) {
        return normalizedModel;
      }

      return getDefaultModelForProvider(provider);
    }

    async function migrateSettings() {
      const raw = await chrome.storage.local.get([
        'apiKey',
        'model',
        'openRouterApiKey',
        'openAIApiKey',
        'anthropicApiKey',
        'geminiApiKey',
        'defaultProvider',
        'defaultModel',
        'translationProfile',
        'selectionTranslateEnabled',
        'selectionTranslateMode',
        'selectionPopoverCloseOnBackdrop',
        'translationPipelineVersion',
        'autoTranslate'
      ]);

      const updates = {};
      if (!raw.openRouterApiKey && typeof raw.apiKey === 'string' && raw.apiKey.trim()) {
        updates.openRouterApiKey = raw.apiKey.trim();
      }
      if (!raw.defaultProvider) {
        updates.defaultProvider = DEFAULT_PROVIDER;
      }

      const provider = updates.defaultProvider || raw.defaultProvider || DEFAULT_PROVIDER;
      if (!raw.defaultModel && typeof raw.model === 'string' && raw.model.trim()) {
        updates.defaultModel = resolveModelForProvider(provider, raw.model);
      } else if (!raw.defaultModel) {
        updates.defaultModel = getDefaultModelForProvider(provider);
      } else if (resolveModelForProvider(provider, raw.defaultModel) !== raw.defaultModel) {
        updates.defaultModel = resolveModelForProvider(provider, raw.defaultModel);
      }

      if (!raw.translationProfile) {
        updates.translationProfile = DEFAULT_PROFILE;
      }
      if (raw.selectionTranslateEnabled === undefined) {
        updates.selectionTranslateEnabled = true;
      }
      if (!raw.selectionTranslateMode) {
        updates.selectionTranslateMode = 'fast';
      }
      if (raw.selectionPopoverCloseOnBackdrop === undefined) {
        updates.selectionPopoverCloseOnBackdrop = false;
      }
      if (!raw.translationPipelineVersion) {
        updates.translationPipelineVersion = PIPELINE_VERSION;
      }
      if (raw.autoTranslate === undefined) {
        updates.autoTranslate = false;
      }

      if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
      }

      return Object.assign({}, raw, updates);
    }

    async function getActiveConfig() {
      const settings = await migrateSettings();
      const provider = PROVIDER_CATALOG[settings.defaultProvider] ? settings.defaultProvider : DEFAULT_PROVIDER;
      const catalog = PROVIDER_CATALOG[provider];
      const apiKey = settings[catalog.apiKeyStorageKey] || '';

      return {
        provider,
        providerLabel: catalog.label,
        apiKey,
        hasApiKey: Boolean(apiKey && apiKey.trim()),
        model: resolveModelForProvider(provider, settings.defaultModel),
        profile: settings.translationProfile === 'precise' ? 'precise' : DEFAULT_PROFILE,
        selectionTranslateEnabled: settings.selectionTranslateEnabled !== false,
        selectionTranslateMode: settings.selectionTranslateMode === 'provider' ? 'provider' : 'fast',
        selectionPopoverCloseOnBackdrop: settings.selectionPopoverCloseOnBackdrop === true,
        autoTranslate: settings.autoTranslate === true,
        translationPipelineVersion: settings.translationPipelineVersion || PIPELINE_VERSION
      };
    }

    function normalizeError(error, providerId) {
      const provider = providerId || DEFAULT_PROVIDER;
      const status = Number(error && error.status);
      const message = error && error.message ? error.message : '알 수 없는 오류가 발생했습니다.';
      if (provider === FAST_PAGE_PROVIDER) {
        return Object.assign(new Error(message || '구글 번역 엔진 응답이 불안정합니다.'), { status, provider });
      }
      if (status === 401 || status === 403) {
        return Object.assign(new Error(`${provider} API 키를 확인해주세요.`), { status, provider });
      }
      if (status === 429) {
        return Object.assign(new Error(`${provider} 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.`), { status, provider });
      }
      if (status >= 500) {
        return Object.assign(new Error(`${provider} 서버 응답이 불안정합니다. 잠시 후 다시 시도해주세요.`), { status, provider });
      }
      return Object.assign(new Error(message), { status, provider });
    }

    function createAbortError() {
      const error = new Error('translation_cancelled');
      error.name = 'AbortError';
      error.retryable = false;
      return error;
    }

    function isAbortError(error) {
      return Boolean(error && (
        error.name === 'AbortError'
        || error.message === 'translation_cancelled'
        || error.code === 20
      ));
    }

    async function parseResponseOrThrow(response, fallbackMessage) {
      let data = null;
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }

      if (!response.ok) {
        const error = new Error(
          (data && data.error && data.error.message)
          || (data && data.message)
          || fallbackMessage
        );
        error.status = response.status;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }

      return data;
    }

    async function runOpenRouterPrompt(prompt, apiKey, model, purpose, signal, temperature) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const body = {
        model,
        messages: [{ role: 'user', content: prompt }]
      };

      if (String(model || '').startsWith('openai/gpt-5')) {
        body.reasoning_effort = 'minimal';
      } else {
        body.temperature = temperature;
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.href,
          'X-Title': `WPT ${purpose || 'Translation'}`
        },
        body: JSON.stringify(body)
      });

      const data = await parseResponseOrThrow(response, `OpenRouter 요청 실패 (${purpose})`);
      return data && data.choices && data.choices[0] && data.choices[0].message
        ? (data.choices[0].message.content || '').trim()
        : '';
    }

    async function runOpenAIPrompt(prompt, apiKey, model, purpose, signal, temperature) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const body = {
        model,
        messages: [{ role: 'user', content: prompt }]
      };

      if (String(model || '').startsWith('gpt-5')) {
        body.reasoning_effort = 'minimal';
      } else {
        body.temperature = temperature;
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await parseResponseOrThrow(response, `OpenAI 요청 실패 (${purpose})`);
      return data && data.choices && data.choices[0] && data.choices[0].message
        ? (data.choices[0].message.content || '').trim()
        : '';
    }

    async function runAnthropicPrompt(prompt, apiKey, model, purpose, signal, temperature) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          temperature,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await parseResponseOrThrow(response, `Anthropic 요청 실패 (${purpose})`);
      return Array.isArray(data && data.content)
        ? data.content.filter((item) => item && item.type === 'text').map((item) => item.text || '').join('\n').trim()
        : '';
    }

    async function runGeminiPrompt(prompt, apiKey, model, purpose, signal, temperature) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature
          }
        })
      });

      const data = await parseResponseOrThrow(response, `Gemini 요청 실패 (${purpose})`);
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
        ? data.candidates[0].content.parts || []
        : [];
      return parts.map((part) => part.text || '').join('\n').trim();
    }

    async function runPrompt(params) {
      const provider = params && params.provider ? params.provider : DEFAULT_PROVIDER;
      const apiKey = params && params.apiKey ? params.apiKey : '';
      const model = params && params.model ? params.model : getDefaultModelForProvider(provider);
      const prompt = params && params.prompt ? params.prompt : '';
      const purpose = params && params.purpose ? params.purpose : 'translation';
      const signal = params && params.signal ? params.signal : undefined;
      const temperature = typeof params?.temperature === 'number' ? params.temperature : 0.2;

      if (!apiKey) {
        throw new Error(`${provider} API 키가 설정되지 않았습니다.`);
      }

      if (signal && signal.aborted) {
        throw createAbortError();
      }

      const runner = provider === 'openai'
        ? runOpenAIPrompt
        : provider === 'anthropic'
          ? runAnthropicPrompt
          : provider === 'gemini'
            ? runGeminiPrompt
            : runOpenRouterPrompt;

      try {
        if (WPT.Api && WPT.Api.executeWithRetry) {
          return await WPT.Api.executeWithRetry(
            () => runner(prompt, apiKey, model, purpose, signal, temperature),
            { maxAttempts: 3, baseDelayMs: 700, backoffFactor: 2 }
          );
        }
        return await runner(prompt, apiKey, model, purpose, signal, temperature);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        throw normalizeError(error, provider);
      }
    }

    async function runFastIndexedTranslation(indexedText, signal) {
      if (signal && signal.aborted) {
        throw createAbortError();
      }

      const response = await chrome.runtime.sendMessage({
        action: 'FAST_TRANSLATE_INDEXED_TEXT',
        text: indexedText,
        targetLanguage: 'ko'
      });

      if (signal && signal.aborted) {
        throw createAbortError();
      }

      if (!response || response.success !== true) {
        const error = new Error((response && response.error) || '구글 번역 요청 실패');
        error.provider = FAST_PAGE_PROVIDER;
        throw error;
      }

      return String(response.translatedText || '').trim();
    }

    function buildIndustryInstruction() {
      return WPT.Industry && WPT.Industry.buildIndustryInstruction
        ? WPT.Industry.buildIndustryInstruction()
        : '- 페이지의 내용을 고려하여 자연스럽고 정확한 한국어로 번역해주세요.';
    }

    function normalizeSegmentInput(segment) {
      if (typeof segment === 'string') {
        return {
          text: segment,
          role: 'body'
        };
      }

      if (segment && typeof segment === 'object') {
        return {
          text: segment.text || segment.serializedText || '',
          role: segment.role || 'body'
        };
      }

      return {
        text: '',
        role: 'body'
      };
    }

    function getRoleHintLabel(role) {
      return role === 'heading'
        ? '제목/헤드라인'
        : role === 'caption'
          ? '캡션/이미지 설명'
          : role === 'quote'
            ? '인용문'
            : role === 'ui'
              ? '보조 UI 텍스트'
              : '본문';
    }

    function getTranslationSafetyRules() {
      return [
        '- 이 요청은 원문을 한국어로 옮기는 변환 작업입니다. 새 사실, 새 자극 표현, 새 유해 정보를 덧붙이지 마세요.',
        '- 원문이 성적, 폭력적, 범죄 관련 내용을 포함하더라도 번역을 거부하거나 삭제하지 말고, 보도체/중립적 어조로 정확히 옮기세요.',
        '- 경고문, 피해 진술, 인용문, 주의 문구는 순화하거나 생략하지 말고 필요한 범위에서만 충실하게 번역하세요.'
      ];
    }

    function createIndexedPrompt(segments, options) {
      const opts = options || {};
      const normalizedSegments = (segments || []).map(normalizeSegmentInput);
      const isPrecise = opts.profile === 'precise' || String(opts.purpose || '').includes('precise');
      const intro = isPrecise
        ? '다음 웹페이지 세그먼트를 의미 손실 없이 정확한 한국어로 번역해주세요.'
        : '다음 웹페이지 세그먼트를 자연스럽고 빠르게 읽히는 한국어로 번역해주세요.';
      const roleHints = normalizedSegments
        .map((segment, index) => segment.role && segment.role !== 'body' ? `- [${index}] ${getRoleHintLabel(segment.role)}` : '')
        .filter(Boolean);
      const modeRules = isPrecise
        ? [
            '- 사실관계, 주어, 시제, 인용 관계, 경고문/단서 문장을 임의로 바꾸거나 누락하지 마세요.',
            '- 기사형 문서라면 제목, 캡션, 인용문, 설명문의 역할과 톤을 유지하세요.',
            '- 역할 힌트가 있는 세그먼트는 제목답게, 캡션답게, 인용문답게 자연스럽게 옮기되 의미를 바꾸지 마세요.',
            '- 인명, 지명, 기관명, 브랜드명, 작품명은 임의로 바꾸지 말고 널리 쓰이는 한글 표기 또는 원문 표기를 유지하세요.',
            ...getTranslationSafetyRules(),
            buildIndustryInstruction(),
            '- 문장을 매끈하게 만들려고 요약, 압축, 재서술, 해설 추가를 하지 마세요.'
          ]
        : [
            '- 빠르게 읽히는 자연스러운 한국어로 번역하세요.',
            ...getTranslationSafetyRules(),
            '- 설명, 서문, 요약, 따옴표를 추가하지 마세요.'
          ];

      return [
        intro,
        '',
        '공통 규칙:',
        '- 각 줄은 반드시 같은 번호의 [0], [1], [2] 형식으로 반환하세요.',
        '- HTML 태그와 [[0::text]] 같은 placeholder는 구조를 유지하세요.',
        ...modeRules,
        ...(roleHints.length > 0 ? ['', '세그먼트 역할 힌트:', ...roleHints] : []),
        '',
        '입력:',
        normalizedSegments.map((segment, index) => `[${index}] ${segment.text}`).join('\n')
      ].join('\n');
    }

    function createTitlePrompt(title, options) {
      const opts = options || {};
      const isPrecise = opts.profile === 'precise';
      const rules = isPrecise
        ? [
            '다음 웹페이지 제목을 사실관계와 주체를 유지한 자연스러운 한국어 제목 한 줄로 번역해주세요.',
            '- 한국어 기사 제목처럼 조사와 어순을 자연스럽게 정리하되, 핵심 주어와 목적어를 생략하지 마세요.',
            '- 제목의 책임 주체, 인용/발언 구조, 고유명사를 임의로 바꾸거나 삭제하지 마세요.',
            ...getTranslationSafetyRules(),
            '- 더 자극적인 표현으로 바꾸거나 요약하지 마세요.',
            buildIndustryInstruction()
          ]
        : [
            '다음 웹페이지 제목을 자연스러운 한국어 제목 한 줄로만 번역해주세요.',
            ...getTranslationSafetyRules(),
            '- 설명, 서문, 따옴표, 번호를 추가하지 마세요.'
          ];

      return [
        ...rules,
        '- 제목만 반환하세요.',
        '',
        `원문 제목: ${title}`
      ].join('\n');
    }

    function createSelectionPrompt(text) {
      return [
        '다음 선택 텍스트를 의미 손실 없이 정확한 한국어로 번역해주세요.',
        '- 원문의 주어, 시제, 인용 관계와 고유명사를 유지하세요.',
        ...getTranslationSafetyRules(),
        '- 설명 없이 번역문만 반환하세요.',
        '',
        text
      ].join('\n');
    }

    function createSelectionExplanationPrompt(text) {
      return [
        '다음 선택 텍스트를 한국어로 이해하기 쉽게 설명해주세요.',
        '- 단어 또는 짧은 표현이면 뜻, 뉘앙스, 자연스러운 해석을 간단히 설명하세요.',
        '- 문장이나 문단이면 핵심 의미를 쉬운 한국어로 풀어주세요.',
        '- 주어진 텍스트 범위를 벗어나 새 사실을 추측해서 덧붙이지 마세요.',
        '- 2~4문장 정도로 간결하게 설명하고, 제목이나 마크다운 없이 설명만 반환하세요.',
        '',
        text
      ].join('\n');
    }

    function createContextPrompt(samples) {
      return [
        '다음은 웹페이지에서 발췌한 텍스트입니다.',
        '콘텐츠가 속한 산업군과 번역 톤을 JSON으로만 반환해주세요.',
        '형식: {"industry":"...", "keywords":["..."], "tone":"...", "summary":"..."}',
        '',
        samples.map((sample, index) => `[${index}] ${sample}`).join('\n')
      ].join('\n');
    }

    function parseIndexedLines(text, expectedCount) {
      const lines = String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const mapped = new Map();
      lines.forEach((line) => {
        const match = line.match(/^\[(\d+)\]\s*([\s\S]+)$/);
        if (match) {
          mapped.set(Number(match[1]), match[2].trim());
        }
      });

      const values = [];
      for (let index = 0; index < expectedCount; index += 1) {
        values[index] = mapped.get(index) || null;
      }

      const mappedCount = values.filter(Boolean).length;
      if (mappedCount < Math.max(1, Math.floor(expectedCount * 0.5))) {
        const fallback = lines.map((line) => line.replace(/^\[\d+\]\s*/, '').trim()).filter(Boolean);
        return values.map((value, index) => value || fallback[index] || null);
      }

      return values;
    }

    async function translateSegments(params) {
      const normalizedSegments = (params.segments || []).map(normalizeSegmentInput);
      if (params.provider === FAST_PAGE_PROVIDER) {
        const indexedInput = normalizedSegments.map((segment, index) => `[${index}] ${segment.text}`).join('\n');
        const responseText = await runFastIndexedTranslation(indexedInput, params.signal);
        return parseIndexedLines(responseText, normalizedSegments.length);
      }

      const responseText = await runPrompt({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        signal: params.signal,
        temperature: params.profile === 'precise' ? 0.05 : 0.2,
        prompt: createIndexedPrompt(normalizedSegments, {
          profile: params.profile,
          purpose: params.purpose
        }),
        purpose: 'translate-segments'
      });
      return parseIndexedLines(responseText, normalizedSegments.length);
    }

    async function translateTitle(params) {
      if (params.provider === FAST_PAGE_PROVIDER) {
        return await runFastIndexedTranslation(String(params.title || ''), params.signal);
      }

      return await runPrompt({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        signal: params.signal,
        temperature: params.profile === 'precise' ? 0.05 : 0.2,
        prompt: createTitlePrompt(params.title || '', { profile: params.profile }),
        purpose: 'translate-title'
      });
    }

    async function translateSelection(params) {
      if (params.provider === FAST_PAGE_PROVIDER) {
        return await runFastIndexedTranslation(String(params.text || ''), params.signal);
      }

      return await runPrompt({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        signal: params.signal,
        temperature: 0.08,
        prompt: createSelectionPrompt(params.text || ''),
        purpose: 'translate-selection'
      });
    }

    async function explainSelection(params) {
      return await runPrompt({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        signal: params.signal,
        temperature: 0.2,
        prompt: createSelectionExplanationPrompt(params.text || ''),
        purpose: 'explain-selection'
      });
    }

    async function detectContext(params) {
      return await runPrompt({
        provider: params.provider,
        apiKey: params.apiKey,
        model: params.model,
        signal: params.signal,
        prompt: createContextPrompt(params.samples || []),
        purpose: 'detect-context'
      });
    }

    WPT.Provider = {
      PIPELINE_VERSION,
      DEFAULT_PROVIDER,
      DEFAULT_PROFILE,
      FAST_PAGE_PROVIDER,
      FAST_PAGE_MODEL,
      PROVIDER_CATALOG,
      getDefaultModelForProvider,
      getActiveConfig,
      normalizeError,
      isAbortError,
      runPrompt,
      translateSegments,
      translateTitle,
      translateSelection,
      explainSelection,
      detectContext
    };
  } catch (_) {
    // no-op
  }
})();
