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

export function getSelectionSearchTargets() {
  return [...SEARCH_TARGETS, SEARCH_ALL_TARGET];
}

export function getSearchTargetLabel(engine) {
  const target = getSelectionSearchTargets().find((item) => item.key === engine);
  return target ? target.label : '검색';
}

export function buildSearchUrl(engine, query) {
  const encodedQuery = encodeURIComponent(String(query || '').trim());
  if (!encodedQuery) {
    return '';
  }

  switch (engine) {
    case 'google':
      return `https://www.google.com/search?q=${encodedQuery}`;
    case 'naver':
      return `https://search.naver.com/search.naver?query=${encodedQuery}`;
    case 'youtube':
      return `https://www.youtube.com/results?search_query=${encodedQuery}`;
    case 'chatgpt':
      return `https://chat.openai.com/?q=${encodedQuery}`;
    case 'perplexity':
      return `https://www.perplexity.ai/search?q=${encodedQuery}`;
    default:
      return '';
  }
}

export function getSearchUrls(engine, query) {
  if (engine === SEARCH_ALL_TARGET.key) {
    return SEARCH_TARGETS
      .map((target) => buildSearchUrl(target.key, query))
      .filter(Boolean);
  }

  const url = buildSearchUrl(engine, query);
  return url ? [url] : [];
}
