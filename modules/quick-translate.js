/**
 * Side Panel 텍스트 번역 기능
 *
 * 역할:
 * - 기본 provider/model/profile을 사용한 직접 텍스트 번역
 * - 선택 번역에서 넘어온 텍스트 수신
 * - 번역 히스토리 저장 및 표시
 */

import { logInfo, logError } from '../logger.js';
import { showToast, switchTab } from './ui-utils.js';
import { consumePendingQuickTranslate, getActiveTranslationConfig, storePendingQuickTranslate } from './storage.js';
import { translateSelection } from './provider-client.js';
import { STORAGE_KEYS } from './constants.js';

const MAX_HISTORY_COUNT = 50;
const STORAGE_KEY = 'quickTranslationHistory';
let pendingListenerBound = false;

/**
 * 텍스트 번역 탭 초기화
 */
export async function initQuickTranslateTab() {
  const translateBtn = document.getElementById('quickTranslateBtn');
  const clearHistoryBtn = document.getElementById('quickClearHistoryBtn');
  const textInput = document.getElementById('quickTextInput');

  translateBtn?.removeEventListener('click', handleTranslateText);
  translateBtn?.addEventListener('click', handleTranslateText);

  clearHistoryBtn?.removeEventListener('click', handleClearHistory);
  clearHistoryBtn?.addEventListener('click', handleClearHistory);

  textInput?.removeEventListener('keydown', handleTextInputKeydown);
  textInput?.addEventListener('keydown', handleTextInputKeydown);

  bindPendingQuickTranslateListener();
  await hydratePendingQuickTranslate();
  await loadTranslationHistory();
}

function bindPendingQuickTranslateListener() {
  if (pendingListenerBound) {
    return;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[STORAGE_KEYS.PENDING_QUICK_TRANSLATE]?.newValue?.text) {
      return;
    }
    void hydratePendingQuickTranslate();
  });
  pendingListenerBound = true;
}

async function hydratePendingQuickTranslate() {
  try {
    const pending = await consumePendingQuickTranslate();
    if (!pending?.text) {
      return;
    }

    const textInput = document.getElementById('quickTextInput');
    if (textInput) {
      textInput.value = pending.text;
    }

    if (pending.translation) {
      displayTranslationResult(pending.text, pending.translation);
    }

    await switchTab('text');
  } catch (error) {
    logError('quickTranslate', 'PENDING_LOAD_ERROR', '선택 번역 연동 실패', {}, error);
  }
}

function handleTextInputKeydown(event) {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    handleTranslateText();
  }
}

async function handleTranslateText() {
  const textInput = document.getElementById('quickTextInput');
  const resultContainer = document.getElementById('quickTranslationResult');
  const translateBtn = document.getElementById('quickTranslateBtn');

  const text = textInput?.value?.trim() || '';
  if (!text) {
    showToast('번역할 텍스트를 입력해주세요.', 'error');
    return;
  }

  const config = await getActiveTranslationConfig();
  if (!config.hasApiKey) {
    showToast(`${config.providerLabel} API Key가 설정되지 않았습니다. 설정 탭에서 입력해주세요.`, 'error');
    return;
  }

  translateBtn.disabled = true;
  translateBtn.textContent = '번역 중...';
  resultContainer.innerHTML = '<div class="quick-loading"><div class="spinner"></div><span>번역 중...</span></div>';
  resultContainer.style.display = 'block';

  try {
    const translation = await translateSelection({
      text,
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey
    });

    displayTranslationResult(text, translation);
    await saveTranslationHistory(text, translation, config);
    await storePendingQuickTranslate({ text: '', translation: '' });
    await loadTranslationHistory();

    textInput.value = '';
    showToast('번역이 완료되었습니다!');
    logInfo('quickTranslate', 'TRANSLATE_SUCCESS', '텍스트 번역 성공', {
      provider: config.provider,
      model: config.model,
      originalLength: text.length
    });
  } catch (error) {
    logError('quickTranslate', 'TRANSLATE_ERROR', '텍스트 번역 실패', {}, error);
    resultContainer.innerHTML = `<div class="quick-error">번역 중 오류가 발생했습니다: ${escapeHtml(error.message)}</div>`;
    showToast('번역 중 오류가 발생했습니다: ' + error.message, 'error');
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = '번역';
  }
}

function displayTranslationResult(original, translation) {
  const resultContainer = document.getElementById('quickTranslationResult');
  if (!resultContainer) {
    return;
  }

  resultContainer.innerHTML = `
    <div class="quick-result-card">
      <div class="quick-result-header">
        <span class="quick-result-label">번역 결과</span>
        <button class="quick-toggle-original" data-original="${escapeHtml(original)}">원문 보기</button>
      </div>
      <div class="quick-result-text">${escapeHtml(translation)}</div>
    </div>
  `;
  resultContainer.style.display = 'block';

  const toggleBtn = resultContainer.querySelector('.quick-toggle-original');
  toggleBtn?.addEventListener('click', handleToggleOriginal);
}

function handleToggleOriginal(event) {
  const btn = event.target;
  const textEl = btn.closest('.quick-result-card').querySelector('.quick-result-text');
  const original = btn.dataset.original;
  const currentText = textEl.textContent;

  if (btn.textContent === '원문 보기') {
    btn.dataset.translation = currentText;
    textEl.textContent = original;
    btn.textContent = '번역문 보기';
  } else {
    textEl.textContent = btn.dataset.translation;
    btn.textContent = '원문 보기';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function saveTranslationHistory(original, translation, config) {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    let history = result[STORAGE_KEY] || [];

    history.unshift({
      id: Date.now(),
      original,
      translation,
      provider: config.provider,
      model: config.model,
      timestamp: Date.now()
    });

    if (history.length > MAX_HISTORY_COUNT) {
      history = history.slice(0, MAX_HISTORY_COUNT);
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: history });
  } catch (error) {
    logError('quickTranslate', 'HISTORY_SAVE_ERROR', '텍스트 번역 히스토리 저장 실패', {}, error);
  }
}

export async function loadTranslationHistory() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const history = result[STORAGE_KEY] || [];
    renderTranslationHistory(history);
  } catch (error) {
    logError('quickTranslate', 'HISTORY_LOAD_ERROR', '텍스트 번역 히스토리 로드 실패', {}, error);
  }
}

function renderTranslationHistory(history) {
  const listContainer = document.getElementById('quickHistoryList');
  const emptyEl = document.getElementById('quickHistoryEmpty');

  if (!listContainer || !emptyEl) {
    return;
  }

  if (history.length === 0) {
    listContainer.style.display = 'none';
    emptyEl.style.display = 'flex';
    return;
  }

  listContainer.style.display = 'flex';
  emptyEl.style.display = 'none';
  listContainer.innerHTML = history.map((item) => {
    const date = new Date(item.timestamp);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="quick-history-item" data-id="${item.id}">
        <div class="quick-history-body">
          <div class="quick-history-translation">${escapeHtml(item.translation)}</div>
          <div class="quick-history-original collapsed">${escapeHtml(item.original)}</div>
          <div class="quick-history-meta">
            <span>${dateStr}</span>
            <span>${escapeHtml(item.provider || 'openrouter')}</span>
            <button class="quick-history-toggle" data-id="${item.id}">원문 보기</button>
          </div>
        </div>
        <button class="quick-history-delete" data-id="${item.id}" title="삭제">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  listContainer.querySelectorAll('.quick-history-toggle').forEach((btn) => {
    btn.addEventListener('click', handleToggleHistoryOriginal);
  });
  listContainer.querySelectorAll('.quick-history-delete').forEach((btn) => {
    btn.addEventListener('click', handleDeleteHistoryItem);
  });
}

function handleToggleHistoryOriginal(event) {
  const btn = event.target;
  const item = btn.closest('.quick-history-item');
  const originalEl = item.querySelector('.quick-history-original');
  const translationEl = item.querySelector('.quick-history-translation');

  if (originalEl.classList.contains('collapsed')) {
    originalEl.classList.remove('collapsed');
    translationEl.classList.add('collapsed');
    btn.textContent = '번역문 보기';
  } else {
    originalEl.classList.add('collapsed');
    translationEl.classList.remove('collapsed');
    btn.textContent = '원문 보기';
  }
}

async function handleDeleteHistoryItem(event) {
  const btn = event.target.closest('.quick-history-delete');
  const id = parseInt(btn.dataset.id, 10);

  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const history = (result[STORAGE_KEY] || []).filter((item) => item.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: history });
    await loadTranslationHistory();
    showToast('삭제되었습니다.');
  } catch (error) {
    logError('quickTranslate', 'HISTORY_DELETE_ERROR', '텍스트 번역 히스토리 삭제 실패', {}, error);
    showToast('삭제 중 오류가 발생했습니다.', 'error');
  }
}

let clearHistoryConfirmTimer = null;

async function handleClearHistory(event) {
  const btn = event.target;

  if (btn.classList.contains('confirm-mode')) {
    if (clearHistoryConfirmTimer) {
      clearTimeout(clearHistoryConfirmTimer);
      clearHistoryConfirmTimer = null;
    }

    btn.classList.remove('confirm-mode');
    btn.textContent = '전체 삭제';

    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
      await loadTranslationHistory();
      showToast('모든 기록이 삭제되었습니다.');
    } catch (error) {
      logError('quickTranslate', 'HISTORY_CLEAR_ERROR', '텍스트 번역 히스토리 전체 삭제 실패', {}, error);
      showToast('삭제 중 오류가 발생했습니다.', 'error');
    }
  } else {
    btn.classList.add('confirm-mode');
    btn.textContent = '정말 삭제하시겠습니까?';
    clearHistoryConfirmTimer = setTimeout(() => {
      btn.classList.remove('confirm-mode');
      btn.textContent = '전체 삭제';
      clearHistoryConfirmTimer = null;
    }, 3000);
  }
}
