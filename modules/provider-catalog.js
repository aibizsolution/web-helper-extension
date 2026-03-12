/**
 * 멀티 프로바이더 카탈로그
 *
 * 역할:
 * - 프로바이더별 저장 키/기본 모델/표시 이름 정의
 * - AI 정밀 번역용 프로바이더/모델 정의
 * - 페이지 번역 프로필(fast/precise) 기본값 정의
 */

export const TRANSLATION_PIPELINE_VERSION = 'v2';
export const FAST_PAGE_PROVIDER = 'builtin-fast';
export const FAST_PAGE_MODEL = 'google-web-mt';
export const FAST_PAGE_ENGINE_LABEL = '초고속 번역 엔진';

export const PROVIDER_CATALOG = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    apiKeyStorageKey: 'openRouterApiKey',
    defaultModel: 'google/gemini-3.1-flash-lite-preview',
    docsUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview' },
      { id: 'openai/gpt-5-nano', label: 'GPT-5 Nano' }
    ]
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    apiKeyStorageKey: 'openAIApiKey',
    defaultModel: 'gpt-5-nano',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-5-nano', label: 'GPT-5 Nano' }
    ]
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    apiKeyStorageKey: 'geminiApiKey',
    defaultModel: 'gemini-3.1-flash-lite-preview',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview' }
    ]
  }
};

export const PROVIDER_IDS = Object.keys(PROVIDER_CATALOG);

export const TRANSLATION_PROFILES = {
  fast: {
    id: 'fast',
    label: '초고속 번역',
    requestBudget: 900,
    parallelRequests: 4,
    readStringCache: true,
    readSnapshotCache: true
  },
  precise: {
    id: 'precise',
    label: 'AI 정밀 번역',
    requestBudget: 700,
    parallelRequests: 2,
    readStringCache: false,
    readSnapshotCache: false
  }
};

export const DEFAULT_PROVIDER = 'openrouter';
export const DEFAULT_PROFILE = 'fast';

/**
 * 프로바이더 ID에 해당하는 카탈로그 항목을 반환한다.
 * @param {string} providerId - 프로바이더 ID
 * @returns {object} 카탈로그 항목
 */
export function getProviderCatalog(providerId) {
  return PROVIDER_CATALOG[providerId] || PROVIDER_CATALOG[DEFAULT_PROVIDER];
}

/**
 * 프로바이더의 기본 모델을 반환한다.
 * @param {string} providerId - 프로바이더 ID
 * @returns {string} 기본 모델명
 */
export function getDefaultModelForProvider(providerId) {
  return getProviderCatalog(providerId).defaultModel;
}

/**
 * 번역 프로필 정보를 반환한다.
 * @param {string} profileId - 프로필 ID
 * @returns {object} 프로필 정보
 */
export function getTranslationProfile(profileId) {
  return TRANSLATION_PROFILES[profileId] || TRANSLATION_PROFILES[DEFAULT_PROFILE];
}
