/**
 * Side Panel 검색 기능
 *
 * 역할:
 * - 기본 provider/model을 사용한 검색 키워드 추천
 * - 검색 엔진 결과 열기
 */

import { logInfo, logError } from '../logger.js';
import { showToast } from './ui-utils.js';
import { getActiveTranslationConfig } from './storage.js';
import { runPrompt } from './provider-client.js';
import {
  SEARCH_ALL_TARGET,
  SEARCH_TARGETS,
  getSearchUrls
} from './search-targets.js';

export function getGoogleIcon() {
  return `<img class="search-engine-icon" alt="Google" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=google.com" style="width: 20px; height: 20px;">`;
}

export function getNaverIcon() {
  return `<img class="search-engine-icon" alt="Naver" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=naver.com" style="width: 20px; height: 20px;">`;
}

export function getBingIcon() {
  return `<img class="search-engine-icon" alt="Bing" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=bing.com" style="width: 20px; height: 20px;">`;
}

export function getChatGPTIcon() {
  return `<img class="search-engine-icon" alt="ChatGPT" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=chatgpt.com" style="width: 20px; height: 20px;">`;
}

export function getPerplexityIcon() {
  return `<img class="search-engine-icon" alt="Perplexity" width="24" height="24" src="https://www.google.com/s2/favicons?sz=128&domain=perplexity.ai" style="width: 20px; height: 20px;">`;
}

function getSearchTargetIcon(engine) {
  switch (engine) {
    case 'google':
      return getGoogleIcon();
    case 'naver':
      return getNaverIcon();
    case 'bing':
      return getBingIcon();
    case 'chatgpt':
      return getChatGPTIcon();
    case 'perplexity':
      return getPerplexityIcon();
    default:
      return '';
  }
}

export function initializeSearchTab() {
  const searchInput = document.getElementById('searchInput');
  const getRecommendationsBtn = document.getElementById('getRecommendationsBtn');

  getRecommendationsBtn?.removeEventListener('click', handleGetRecommendations);
  getRecommendationsBtn?.addEventListener('click', handleGetRecommendations);

  searchInput?.removeEventListener('input', resetSearchRecommendations);
  searchInput?.addEventListener('input', resetSearchRecommendations);

  searchInput?.removeEventListener('keydown', handleSearchKeydown);
  searchInput?.addEventListener('keydown', handleSearchKeydown);
}

function handleSearchKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleGetRecommendations();
  }
}

async function handleGetRecommendations() {
  const searchInput = document.getElementById('searchInput');
  const query = searchInput?.value?.trim() || '';

  if (!query) {
    showToast('검색 내용을 입력해주세요.', 'error');
    return;
  }

  const config = await getActiveTranslationConfig();
  if (!config.hasApiKey) {
    showToast(`${config.providerLabel} API Key가 설정되지 않았습니다.`, 'error');
    return;
  }

  const loadingEl = document.getElementById('searchLoadingState');
  loadingEl.style.display = 'flex';

  try {
    const container = document.getElementById('searchRecommendations');
    const currentCount = container.children.length;
    if (currentCount >= 10) {
      showToast('최대 10개의 검색 추천을 표시할 수 있습니다.', 'error');
      return;
    }

    const recommendations = [];
    if (currentCount === 0) {
      recommendations.push(query);
    }

    const aiRecommendations = await getSearchRecommendations(query, config);
    const remainingSlots = 10 - currentCount - (currentCount === 0 ? 1 : 0);
    recommendations.push(...aiRecommendations.slice(0, Math.min(3, remainingSlots)));

    renderSearchRecommendations(recommendations);
    logInfo('sidepanel', 'SEARCH_SUCCESS', '검색 추천 완료', {
      provider: config.provider,
      count: recommendations.length
    });
  } catch (error) {
    logError('sidepanel', 'SEARCH_ERROR', '검색 추천 실패', {}, error);
    showToast('검색 생성 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    loadingEl.style.display = 'none';
  }
}

async function getSearchRecommendations(query, config) {
  const prompt = [
    '사용자의 검색 목적을 바탕으로 실제 검색 엔진에서 잘 작동할 검색 키워드 3개를 만들어주세요.',
    '- 각 검색문은 한 줄씩만 반환하세요.',
    '- 번호, 불릿, 설명을 붙이지 마세요.',
    '- 한국어/영어/혼합 모두 허용합니다.',
    '',
    `검색 목적: ${query}`
  ].join('\n');

  const response = await runPrompt({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    prompt,
    purpose: 'search-suggestions'
  });

  return response
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function renderSearchRecommendations(newRecommendations) {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');

  if (!container || !emptyEl || !Array.isArray(newRecommendations)) {
    return;
  }

  newRecommendations.forEach((query) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'search-item';

    const textEl = document.createElement('div');
    textEl.className = 'search-item-text';
    textEl.textContent = query;

    const enginesEl = document.createElement('div');
    enginesEl.className = 'search-item-engines';

    const engines = SEARCH_TARGETS.map((target) => ({
      name: target.key,
      label: target.label,
      svg: getSearchTargetIcon(target.key)
    }));

    engines.forEach((engine) => {
      const btn = document.createElement('button');
      btn.className = 'search-engine-btn';
      btn.innerHTML = engine.svg;
      btn.title = engine.label;
      btn.setAttribute('data-engine', engine.name);
      btn.onclick = () => openSearchResults(engine.name, query);
      enginesEl.appendChild(btn);
    });

    const allBtn = document.createElement('button');
    allBtn.className = 'search-engine-btn all';
    allBtn.textContent = 'All';
    allBtn.title = SEARCH_ALL_TARGET.label;
    allBtn.onclick = () => openAllSearchEngines(query);
    enginesEl.appendChild(allBtn);

    itemEl.appendChild(textEl);
    itemEl.appendChild(enginesEl);
    container.appendChild(itemEl);
  });

  emptyEl.classList.add('hidden');
}

export function resetSearchRecommendations() {
  const container = document.getElementById('searchRecommendations');
  const emptyEl = document.getElementById('searchEmpty');
  if (container) {
    container.innerHTML = '';
  }
  emptyEl?.classList.remove('hidden');
}

function openSearchResults(engine, query) {
  const [url] = getSearchUrls(engine, query);
  if (!url) {
    return;
  }

  chrome.tabs.create({ url, active: false });
}

export function openAllSearchEngines(query) {
  const urls = getSearchUrls(SEARCH_ALL_TARGET.key, query);

  urls.forEach((url) => chrome.tabs.create({ url, active: false }));
  showToast(`"${query}"를 ${urls.length}개 검색 엔진에서 열었습니다!`);
}
