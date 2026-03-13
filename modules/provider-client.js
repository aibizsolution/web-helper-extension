/**
 * 멀티 프로바이더 번역/프롬프트 클라이언트
 *
 * 역할:
 * - OpenRouter / OpenAI / Anthropic / Gemini 직접 호출
 * - 번역/제목/선택/컨텍스트 탐지용 공용 프롬프트 래퍼 제공
 */

import { DEFAULT_PROVIDER } from './provider-catalog.js';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 700;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * 에러 객체를 사용자 표시용 메시지로 정규화한다.
 * @param {Error} error - 원본 에러
 * @param {string} provider - 프로바이더 ID
 * @returns {Error} 정규화된 에러
 */
export function normalizeError(error, provider = DEFAULT_PROVIDER) {
  const message = error?.message || '알 수 없는 오류가 발생했습니다.';
  const status = Number(error?.status);

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

/**
 * OpenRouter 현재 API Key 상태를 조회한다.
 * @param {string} apiKey - OpenRouter API Key
 * @returns {Promise<object>} 키 상태 정보
 */
export async function fetchOpenRouterKeyStatus(apiKey) {
  const normalizedApiKey = String(apiKey || '').trim();

  if (!normalizedApiKey) {
    throw new Error('OpenRouter API Key를 먼저 입력해주세요.');
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`
      }
    });

    const payload = await parseResponseOrThrow(response, 'OpenRouter 키 상태 조회 실패');
    const data = payload?.data || {};

    return {
      name: data?.name || '',
      label: data?.label || '',
      limit: typeof data?.limit === 'number' ? data.limit : null,
      limitRemaining: typeof data?.limit_remaining === 'number' ? data.limit_remaining : null,
      limitReset: data?.limit_reset || null,
      usage: typeof data?.usage === 'number' ? data.usage : null,
      usageDaily: typeof data?.usage_daily === 'number' ? data.usage_daily : null,
      usageWeekly: typeof data?.usage_weekly === 'number' ? data.usage_weekly : null,
      usageMonthly: typeof data?.usage_monthly === 'number' ? data.usage_monthly : null,
      includeByokInLimit: data?.include_byok_in_limit === true,
      isFreeTier: data?.is_free_tier === true
    };
  } catch (error) {
    throw normalizeError(error, 'OpenRouter');
  }
}

async function executeWithRetry(task) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 429 || status >= 500 || error?.retryable === true;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        throw error;
      }
      await wait(BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }

  throw lastError;
}

function extractJsonError(data, fallback) {
  return data?.error?.message || data?.message || fallback;
}

async function parseResponseOrThrow(response, fallbackMessage) {
  let data = null;

  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(extractJsonError(data, fallbackMessage));
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  return data;
}

function getTranslationSafetyRules() {
  return [
    '- 이 요청은 원문을 한국어로 옮기는 변환 작업입니다. 새 사실, 새 자극 표현, 새 유해 정보를 덧붙이지 마세요.',
    '- 원문이 성적, 폭력적, 범죄 관련 내용을 포함하더라도 번역을 거부하거나 삭제하지 말고, 보도체/중립적 어조로 정확히 옮기세요.',
    '- 경고문, 피해 진술, 인용문, 주의 문구는 순화하거나 생략하지 말고 필요한 범위에서만 충실하게 번역하세요.'
  ];
}

function createIndexedPrompt(segments, purpose = 'page') {
  const intro = purpose === 'selection'
    ? '다음 텍스트를 의미 손실 없이 정확한 한국어로 번역해주세요.'
    : '다음 웹페이지 세그먼트를 의미 손실 없이 정확한 한국어로 번역해주세요.';

  return [
    intro,
    '',
    '규칙:',
    '- 각 줄은 반드시 같은 번호의 [0], [1], [2] 형식으로 반환하세요.',
    '- HTML 태그와 [[0::text]] 같은 placeholder는 구조를 유지하세요.',
    '- 사실관계, 주어, 시제, 인용 관계와 고유명사를 임의로 바꾸지 마세요.',
    ...getTranslationSafetyRules(),
    '- 설명, 서문, 요약, 따옴표를 추가하지 마세요.',
    '',
    '입력:',
    segments.map((segment, index) => `[${index}] ${segment}`).join('\n')
  ].join('\n');
}

function createTitlePrompt(title) {
  return [
    '다음 웹페이지 제목을 사실관계와 주체를 유지한 자연스러운 한국어 제목 한 줄로만 번역해주세요.',
    '- 설명, 서문, 따옴표, 번호를 추가하지 마세요.',
    '- 고유명사와 인용 구조를 바꾸지 마세요.',
    ...getTranslationSafetyRules(),
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

  const values = Array.from({ length: expectedCount }, (_, index) => mapped.get(index) || null);
  const mappedCount = values.filter(Boolean).length;

  if (mappedCount < Math.max(1, Math.floor(expectedCount * 0.5))) {
    const fallbackLines = lines.map((line) => line.replace(/^\[\d+\]\s*/, '').trim()).filter(Boolean);
    return Array.from({ length: expectedCount }, (_, index) => fallbackLines[index] || null);
  }

  return values;
}

function extractAnthropicText(data) {
  const texts = Array.isArray(data?.content)
    ? data.content.filter((item) => item?.type === 'text').map((item) => item.text || '')
    : [];
  return texts.join('\n').trim();
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || '').join('\n').trim();
}

async function runOpenRouterPrompt({ prompt, apiKey, model, purpose }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }]
  };

  if (String(model || '').startsWith('openai/gpt-5')) {
    body.reasoning_effort = 'minimal';
  } else {
    body.temperature = 0.2;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href,
      'X-Title': `WPT ${purpose || 'Translation'}`
    },
    body: JSON.stringify(body)
  });

  const data = await parseResponseOrThrow(response, `OpenRouter 요청 실패 (${purpose})`);
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function runOpenAIPrompt({ prompt, apiKey, model, purpose }) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }]
  };

  if (String(model || '').startsWith('gpt-5')) {
    body.reasoning_effort = 'minimal';
  } else {
    body.temperature = 0.2;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await parseResponseOrThrow(response, `OpenAI 요청 실패 (${purpose})`);
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function runAnthropicPrompt({ prompt, apiKey, model, purpose }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await parseResponseOrThrow(response, `Anthropic 요청 실패 (${purpose})`);
  return extractAnthropicText(data);
}

async function runGeminiPrompt({ prompt, apiKey, model, purpose }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
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
        temperature: 0.2
      }
    })
  });

  const data = await parseResponseOrThrow(response, `Gemini 요청 실패 (${purpose})`);
  return extractGeminiText(data);
}

/**
 * 프로바이더별 단일 프롬프트 실행.
 * @param {object} params - 실행 파라미터
 * @returns {Promise<string>} 응답 텍스트
 */
export async function runPrompt(params) {
  const provider = params?.provider || DEFAULT_PROVIDER;
  const apiKey = params?.apiKey || '';
  const model = params?.model || '';
  const prompt = params?.prompt || '';
  const purpose = params?.purpose || 'translation';

  if (!apiKey) {
    throw new Error(`${provider} API 키가 설정되지 않았습니다.`);
  }

  const runner = provider === 'openai'
    ? runOpenAIPrompt
    : provider === 'anthropic'
      ? runAnthropicPrompt
      : provider === 'gemini'
        ? runGeminiPrompt
        : runOpenRouterPrompt;

  try {
    return await executeWithRetry(() => runner({ prompt, apiKey, model, purpose }));
  } catch (error) {
    throw normalizeError(error, provider);
  }
}

/**
 * 세그먼트 배열을 번역한다.
 * @param {object} params - 프로바이더/모델/세그먼트 설정
 * @returns {Promise<Array<string>>} 번역 결과 배열
 */
export async function translateSegments({ segments, model, apiKey, provider, profile, purpose }) {
  const prompt = createIndexedPrompt(segments, purpose || profile || 'page');
  const responseText = await runPrompt({
    provider,
    model,
    apiKey,
    prompt,
    purpose: purpose || 'translate-segments'
  });

  return parseIndexedLines(responseText, segments.length);
}

/**
 * 제목을 번역한다.
 * @param {object} params - 제목 번역 설정
 * @returns {Promise<string>} 번역된 제목
 */
export async function translateTitle({ title, model, apiKey, provider }) {
  return await runPrompt({
    provider,
    model,
    apiKey,
    prompt: createTitlePrompt(title),
    purpose: 'translate-title'
  });
}

/**
 * 선택 텍스트를 번역한다.
 * @param {object} params - 선택 텍스트 번역 설정
 * @returns {Promise<string>} 번역문
 */
export async function translateSelection({ text, model, apiKey, provider }) {
  return await runPrompt({
    provider,
    model,
    apiKey,
    prompt: createSelectionPrompt(text),
    purpose: 'translate-selection'
  });
}

/**
 * 산업군 컨텍스트를 탐지한다.
 * @param {object} params - 컨텍스트 탐지 설정
 * @returns {Promise<string>} 원본 JSON 문자열
 */
export async function detectContext({ samples, model, apiKey, provider }) {
  return await runPrompt({
    provider,
    model,
    apiKey,
    prompt: createContextPrompt(samples),
    purpose: 'detect-context'
  });
}
