/**
 * 설정/마이그레이션 공용 모듈
 *
 * 역할:
 * - 레거시 저장 키(apiKey/model) → 멀티 프로바이더 저장소로 마이그레이션
 * - 현재 기본 프로바이더/모델/프로필 조회
 * - 번역 관련 설정 접근을 중앙화
 */

import {
  DEFAULT_PROFILE,
  DEFAULT_PROVIDER,
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  TRANSLATION_PIPELINE_VERSION,
  getDefaultModelForProvider
} from './provider-catalog.js';
import { STORAGE_KEYS } from './constants.js';

const LEGACY_KEYS = ['apiKey', 'model', 'batchSize', 'concurrency'];
const SETTING_KEYS = [
  'openRouterApiKey',
  'openAIApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'defaultProvider',
  'defaultModel',
  'translationProfile',
  'selectionTranslateEnabled',
  'selectionTranslateMode',
  'translationPipelineVersion',
  'autoTranslate',
  'debugLog',
  'cacheTTL',
  ...LEGACY_KEYS
];

let migrationPromise = null;

function resolveSelectionTranslateMode(mode) {
  return mode === 'provider' ? 'provider' : 'fast';
}

function resolveModelForProvider(providerId, modelId) {
  const provider = PROVIDER_CATALOG[providerId] ? providerId : DEFAULT_PROVIDER;
  const catalog = PROVIDER_CATALOG[provider];
  const normalizedModel = typeof modelId === 'string' ? modelId.trim() : '';

  if (normalizedModel && catalog.models.some((model) => model.id === normalizedModel)) {
    return normalizedModel;
  }

  return catalog.defaultModel;
}

/**
 * 저장소 기본값을 정규화한다.
 * @param {object} raw - storage에서 읽은 값
 * @returns {object} 정규화된 설정
 */
function normalizeSettings(raw) {
  const provider = PROVIDER_CATALOG[raw.defaultProvider] ? raw.defaultProvider : DEFAULT_PROVIDER;
  const model = resolveModelForProvider(provider, raw.defaultModel);
  const profile = raw.translationProfile === 'precise' ? 'precise' : DEFAULT_PROFILE;

  return {
    openRouterApiKey: raw.openRouterApiKey || '',
    openAIApiKey: raw.openAIApiKey || '',
    anthropicApiKey: raw.anthropicApiKey || '',
    geminiApiKey: raw.geminiApiKey || '',
    defaultProvider: provider,
    defaultModel: model,
    translationProfile: profile,
    selectionTranslateEnabled: raw.selectionTranslateEnabled !== false,
    selectionTranslateMode: resolveSelectionTranslateMode(raw.selectionTranslateMode),
    translationPipelineVersion: raw.translationPipelineVersion || TRANSLATION_PIPELINE_VERSION,
    autoTranslate: raw.autoTranslate === true,
    debugLog: !!raw.debugLog,
    cacheTTL: raw.cacheTTL,
    batchSize: raw.batchSize,
    concurrency: raw.concurrency
  };
}

/**
 * 레거시 설정을 멀티 프로바이더 구조로 한 번만 마이그레이션한다.
 * @returns {Promise<object>} 정규화된 설정
 */
export async function migrateLegacySettings() {
  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    const raw = await chrome.storage.local.get(SETTING_KEYS);
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

    if (!raw.translationPipelineVersion) {
      updates.translationPipelineVersion = TRANSLATION_PIPELINE_VERSION;
    }

    if (raw.autoTranslate === undefined) {
      updates.autoTranslate = false;
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }

    return normalizeSettings({ ...raw, ...updates });
  })().finally(() => {
    migrationPromise = null;
  });

  return migrationPromise;
}

/**
 * 현재 전체 설정을 조회한다.
 * @returns {Promise<object>} 정규화된 설정
 */
export async function getExtensionSettings() {
  return await migrateLegacySettings();
}

/**
 * API Key가 입력된 프로바이더 목록을 반환한다.
 * @returns {Promise<Array<object>>} 활성 프로바이더 카탈로그 목록
 */
export async function getConfiguredProviders() {
  const settings = await getExtensionSettings();

  return PROVIDER_IDS
    .map((providerId) => PROVIDER_CATALOG[providerId])
    .filter((catalog) => Boolean((settings[catalog.apiKeyStorageKey] || '').trim()));
}

/**
 * 활성 프로바이더 구성(provider/model/profile/apiKey)을 반환한다.
 * @returns {Promise<object>} 활성 구성
 */
export async function getActiveTranslationConfig() {
  const settings = await getExtensionSettings();
  const providerCatalog = PROVIDER_CATALOG[settings.defaultProvider] || PROVIDER_CATALOG[DEFAULT_PROVIDER];
  const apiKey = settings[providerCatalog.apiKeyStorageKey] || '';

  return {
    provider: providerCatalog.id,
    providerLabel: providerCatalog.label,
    model: resolveModelForProvider(providerCatalog.id, settings.defaultModel),
    profile: settings.translationProfile || DEFAULT_PROFILE,
    apiKey,
    hasApiKey: Boolean(apiKey && apiKey.trim()),
    selectionTranslateEnabled: settings.selectionTranslateEnabled !== false,
    selectionTranslateMode: resolveSelectionTranslateMode(settings.selectionTranslateMode),
    autoTranslate: settings.autoTranslate === true,
    debugLog: !!settings.debugLog
  };
}

/**
 * 특정 프로바이더의 API 키를 조회한다.
 * @param {string} providerId - 프로바이더 ID
 * @returns {Promise<string>} API 키
 */
export async function getProviderApiKey(providerId) {
  const settings = await getExtensionSettings();
  const catalog = PROVIDER_CATALOG[providerId] || PROVIDER_CATALOG[DEFAULT_PROVIDER];
  return settings[catalog.apiKeyStorageKey] || '';
}

/**
 * 활성 프로바이더의 API 키를 조회한다.
 * 레거시 호출부(search/geo)를 위해 유지한다.
 * @returns {Promise<string>} API 키
 */
export async function getApiKey() {
  const config = await getActiveTranslationConfig();
  return config.apiKey || '';
}

/**
 * 활성 모델을 조회한다.
 * 레거시 호출부(search/geo)를 위해 유지한다.
 * @returns {Promise<string>} 모델명
 */
export async function getModel() {
  const config = await getActiveTranslationConfig();
  return config.model;
}

/**
 * 설정 일부를 저장한다.
 * @param {object} partial - 저장할 필드
 * @returns {Promise<object>} 저장 후 정규화된 설정
 */
export async function saveExtensionSettings(partial) {
  const current = await getExtensionSettings();
  const next = normalizeSettings({ ...current, ...(partial || {}) });
  await chrome.storage.local.set(next);
  return next;
}

/**
 * 번역 탭 상단 드롭다운 변경을 즉시 저장한다.
 * @param {object} values - 변경값
 * @returns {Promise<object>} 저장 후 구성
 */
export async function updateActiveTranslationConfig(values) {
  const current = await getExtensionSettings();
  const provider = PROVIDER_CATALOG[values.provider] ? values.provider : current.defaultProvider;
  const model = resolveModelForProvider(provider, values.model);
  const profile = values.profile === 'precise' ? 'precise' : values.profile === 'fast' ? 'fast' : current.translationProfile;

  await chrome.storage.local.set({
    defaultProvider: provider,
    defaultModel: model,
    translationProfile: profile,
    translationPipelineVersion: TRANSLATION_PIPELINE_VERSION
  });

  return await getActiveTranslationConfig();
}

/**
 * 프로바이더별 폼 필드에 쓰기 좋은 설정 객체를 반환한다.
 * @returns {Promise<object>} 설정 객체
 */
export async function getSettingsForForm() {
  const settings = await getExtensionSettings();
  const providers = PROVIDER_IDS.map((providerId) => {
    const catalog = PROVIDER_CATALOG[providerId];
    return {
      id: providerId,
      label: catalog.label,
      apiKeyStorageKey: catalog.apiKeyStorageKey,
      apiKey: settings[catalog.apiKeyStorageKey] || '',
      docsUrl: catalog.docsUrl,
      models: catalog.models
    };
  });

  return {
    ...settings,
    providers
  };
}

/**
 * 선택 번역을 사이드패널로 넘기기 위한 임시 페이로드를 저장한다.
 * @param {object} payload - 선택 번역 데이터
 * @returns {Promise<void>}
 */
export async function storePendingQuickTranslate(payload) {
  await chrome.storage.session.set({
    [STORAGE_KEYS.PENDING_QUICK_TRANSLATE]: {
      text: payload?.text || '',
      translation: payload?.translation || '',
      ts: Date.now()
    }
  });
}

/**
 * 저장된 선택 번역 페이로드를 읽고 제거한다.
 * @returns {Promise<object|null>} 선택 번역 데이터
 */
export async function consumePendingQuickTranslate() {
  const result = await chrome.storage.session.get([STORAGE_KEYS.PENDING_QUICK_TRANSLATE]);
  const payload = result[STORAGE_KEYS.PENDING_QUICK_TRANSLATE] || null;
  await chrome.storage.session.remove(STORAGE_KEYS.PENDING_QUICK_TRANSLATE);
  return payload;
}
