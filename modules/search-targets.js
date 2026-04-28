export const SEARCH_TARGETS = [
  { key: 'google', label: 'Google' },
  { key: 'naver', label: 'Naver' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'perplexity', label: 'Perplexity' }
];

export const SEARCH_ALL_TARGET = {
  key: 'all',
  label: '전체 검색'
};

const LEGACY_SEARCH_TARGETS = [
  { key: 'bing', label: 'Bing' }
];

export function getSelectionSearchTargets() {
  return [...SEARCH_TARGETS, SEARCH_ALL_TARGET];
}

export function getSupportedSearchTargetKeys() {
  return [
    ...SEARCH_TARGETS.map((target) => target.key),
    SEARCH_ALL_TARGET.key,
    ...LEGACY_SEARCH_TARGETS.map((target) => target.key)
  ];
}

export function normalizeSearchEngine(engine) {
  return String(engine || '').trim().toLowerCase();
}

export function getSearchTargetLabel(engine) {
  const normalizedEngine = normalizeSearchEngine(engine);
  const target = [...getSelectionSearchTargets(), ...LEGACY_SEARCH_TARGETS]
    .find((item) => item.key === normalizedEngine);
  return target ? target.label : '검색';
}

export function buildSearchUrl(engine, query) {
  const normalizedEngine = normalizeSearchEngine(engine);
  const encodedQuery = encodeURIComponent(String(query || '').trim());
  if (!encodedQuery) {
    return '';
  }

  switch (normalizedEngine) {
    case 'google':
      return `https://www.google.com/search?q=${encodedQuery}`;
    case 'naver':
      return `https://search.naver.com/search.naver?query=${encodedQuery}`;
    case 'youtube':
      return `https://www.youtube.com/results?search_query=${encodedQuery}`;
    case 'bing':
      return `https://www.bing.com/search?q=${encodedQuery}`;
    case 'chatgpt':
      return `https://chat.openai.com/?q=${encodedQuery}`;
    case 'perplexity':
      return `https://www.perplexity.ai/search?q=${encodedQuery}`;
    default:
      return '';
  }
}

export function getSearchUrls(engine, query) {
  const normalizedEngine = normalizeSearchEngine(engine);
  if (normalizedEngine === SEARCH_ALL_TARGET.key) {
    return SEARCH_TARGETS
      .map((target) => buildSearchUrl(target.key, query))
      .filter(Boolean);
  }

  const url = buildSearchUrl(normalizedEngine, query);
  return url ? [url] : [];
}
