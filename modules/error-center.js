import { clearLogs, getLogEntries, getLogs, logDebug, logError } from '../logger.js';
import { escapeHtml } from './panel-dom.js';
import { handleCopyLogs, showToast, updateErrorLogCount } from './ui-utils.js';

const ISSUE_LEVELS = new Set(['ERROR', 'WARN']);
const MAX_VISIBLE_ISSUES = 24;
const CLEAR_CONFIRM_TIMEOUT_MS = 2500;

let isInitialized = false;
let clearConfirmTimer = null;

function isIssueEntry(entry) {
  return ISSUE_LEVELS.has(String(entry?.level || '').toUpperCase());
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

function buildSummaryText(issueEntries, allLogs) {
  const errorEntries = issueEntries.filter((entry) => String(entry.level).toUpperCase() === 'ERROR');
  const warnEntries = issueEntries.filter((entry) => String(entry.level).toUpperCase() === 'WARN');
  const topEntries = issueEntries.slice(0, 8);
  const lines = [
    '[웹 도우미 오류 요약]',
    `생성 시각: ${formatDateTime(new Date().toISOString())}`,
    `이슈 수: ${issueEntries.length}개 (오류 ${errorEntries.length} / 경고 ${warnEntries.length})`,
    `전체 로그 수: ${allLogs.length}개`,
    ''
  ];

  if (topEntries.length === 0) {
    lines.push('최근 이슈: 없음');
    return lines.join('\n');
  }

  lines.push('최근 이슈:');
  topEntries.forEach((entry, index) => {
    lines.push(`${index + 1}. [${formatDateTime(entry.ts)}] ${entry.level || 'UNKNOWN'} ${entry.ns || 'unknown'} / ${entry.evt || 'RAW_LOG'}`);

    if (entry.msg) {
      lines.push(`   메시지: ${entry.msg}`);
    }

    if (entry.err) {
      lines.push(`   오류: ${entry.err}`);
    }

    if (entry.stack) {
      const firstStackLine = String(entry.stack).split('\n').find(Boolean);
      if (firstStackLine) {
        lines.push(`   스택: ${firstStackLine}`);
      }
    }
  });

  return lines.join('\n');
}

function renderIssueListHtml(issueEntries) {
  return issueEntries.slice(0, MAX_VISIBLE_ISSUES).map((entry) => {
    const level = String(entry.level || 'ERROR').toUpperCase();
    const levelClass = level === 'ERROR' ? 'is-error' : 'is-warn';
    const message = escapeHtml(entry.msg || entry.raw || '메시지 없음');
    const detail = entry.err ? `<div class="errors-item-detail">${escapeHtml(entry.err)}</div>` : '';
    const stack = entry.stack
      ? `
        <details class="errors-item-stack-wrap">
          <summary>스택 보기</summary>
          <pre class="errors-item-stack">${escapeHtml(entry.stack)}</pre>
        </details>
      `
      : '';

    return `
      <article class="errors-item">
        <div class="errors-item-top">
          <div class="errors-item-head">
            <span class="errors-level-badge ${levelClass}">${escapeHtml(level)}</span>
            <span class="errors-item-namespace">${escapeHtml(entry.ns || 'unknown')}</span>
            <span class="errors-item-event">${escapeHtml(entry.evt || 'RAW_LOG')}</span>
          </div>
          <span class="errors-item-time">${escapeHtml(formatDateTime(entry.ts))}</span>
        </div>
        <div class="errors-item-message">${message}</div>
        ${detail}
        ${stack}
      </article>
    `;
  }).join('');
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = String(value);
  }
}

function resetClearConfirmState() {
  const button = document.getElementById('errorCenterClearBtn');
  if (clearConfirmTimer) {
    window.clearTimeout(clearConfirmTimer);
    clearConfirmTimer = null;
  }

  if (!button) {
    return;
  }

  button.dataset.confirming = 'false';
  button.textContent = '모두 삭제';
  button.classList.remove('is-confirming');
}

function armClearConfirmState() {
  const button = document.getElementById('errorCenterClearBtn');
  if (!button) {
    return;
  }

  resetClearConfirmState();
  button.dataset.confirming = 'true';
  button.textContent = '삭제 확인';
  button.classList.add('is-confirming');
  clearConfirmTimer = window.setTimeout(() => {
    resetClearConfirmState();
  }, CLEAR_CONFIRM_TIMEOUT_MS);
}

function updateToolbarState(issueEntries, allLogs) {
  const copySummaryBtn = document.getElementById('errorCenterCopySummaryBtn');
  const copyErrorsBtn = document.getElementById('errorCenterCopyErrorsBtn');
  const copyAllBtn = document.getElementById('errorCenterCopyAllBtn');
  const clearBtn = document.getElementById('errorCenterClearBtn');

  if (copySummaryBtn) {
    copySummaryBtn.disabled = issueEntries.length === 0;
  }

  if (copyErrorsBtn) {
    copyErrorsBtn.disabled = issueEntries.length === 0;
  }

  if (copyAllBtn) {
    copyAllBtn.disabled = allLogs.length === 0;
  }

  if (clearBtn) {
    clearBtn.disabled = allLogs.length === 0;
    if (allLogs.length === 0) {
      resetClearConfirmState();
    }
  }
}

export async function refreshErrorCenterTab() {
  try {
    const allEntries = await getLogEntries();
    const allLogs = await getLogs();
    const issueEntries = allEntries
      .filter(isIssueEntry)
      .sort((left, right) => new Date(right.ts || 0).getTime() - new Date(left.ts || 0).getTime());
    const errorCount = issueEntries.filter((entry) => String(entry.level).toUpperCase() === 'ERROR').length;
    const warnCount = issueEntries.filter((entry) => String(entry.level).toUpperCase() === 'WARN').length;
    const listEl = document.getElementById('errorsList');
    const emptyEl = document.getElementById('errorsEmpty');
    const listMetaEl = document.getElementById('errorsListMeta');

    setText('errorsIssueCount', issueEntries.length);
    setText('errorsErrorCount', errorCount);
    setText('errorsWarnCount', warnCount);
    setText('errorsLogCount', allLogs.length);

    if (listMetaEl) {
      const visibleCount = Math.min(issueEntries.length, MAX_VISIBLE_ISSUES);
      listMetaEl.textContent = visibleCount > 0 ? `최근 ${visibleCount}개 표시` : '최근 0개 표시';
    }

    if (listEl) {
      listEl.innerHTML = issueEntries.length > 0 ? renderIssueListHtml(issueEntries) : '';
    }

    if (emptyEl) {
      emptyEl.style.display = issueEntries.length > 0 ? 'none' : 'flex';
    }

    updateToolbarState(issueEntries, allLogs);
    await updateErrorLogCount();
  } catch (error) {
    logError('sidepanel', 'ERROR_CENTER_REFRESH_FAILED', '오류 센터 새로고침 실패', {}, error);
  }
}

async function handleCopySummary() {
  try {
    const allLogs = await getLogs();
    const issueEntries = (await getLogEntries())
      .filter(isIssueEntry)
      .sort((left, right) => new Date(right.ts || 0).getTime() - new Date(left.ts || 0).getTime());

    if (issueEntries.length === 0) {
      showToast('복사할 오류 요약이 없습니다.', 'error');
      return;
    }

    await navigator.clipboard.writeText(buildSummaryText(issueEntries, allLogs));
    showToast('오류 요약을 복사했습니다.');
  } catch (error) {
    logError('sidepanel', 'ERROR_SUMMARY_COPY_FAILED', '오류 요약 복사 실패', {}, error);
    showToast('오류 요약 복사 중 문제가 발생했습니다.', 'error');
  }
}

async function handleClearLogsClick() {
  const button = document.getElementById('errorCenterClearBtn');
  if (!button || button.disabled) {
    return;
  }

  if (button.dataset.confirming !== 'true') {
    armClearConfirmState();
    showToast('로그를 지우려면 모두 삭제를 한 번 더 눌러주세요.');
    return;
  }

  try {
    resetClearConfirmState();
    await clearLogs();
    await refreshErrorCenterTab();
    showToast('오류 로그를 모두 지웠습니다.');
  } catch (error) {
    logError('sidepanel', 'ERROR_LOG_CLEAR_FAILED', '오류 로그 삭제 실패', {}, error);
    showToast('오류 로그 삭제 중 문제가 발생했습니다.', 'error');
  }
}

function bindButtons() {
  document.getElementById('errorCenterCopySummaryBtn')?.addEventListener('click', () => {
    void handleCopySummary();
  });
  document.getElementById('errorCenterCopyErrorsBtn')?.addEventListener('click', () => {
    void handleCopyLogs('errors');
  });
  document.getElementById('errorCenterCopyAllBtn')?.addEventListener('click', () => {
    void handleCopyLogs('all');
  });
  document.getElementById('errorCenterClearBtn')?.addEventListener('click', () => {
    void handleClearLogsClick();
  });
}

function bindStorageChangeListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'session' || !changes.wptLogs) {
      return;
    }

    void refreshErrorCenterTab();
  });
}

export function initErrorCenterTab() {
  if (isInitialized) {
    return;
  }

  bindButtons();
  bindStorageChangeListener();
  void refreshErrorCenterTab().catch((error) => {
    logDebug('sidepanel', 'ERROR_CENTER_INIT_REFRESH_SKIPPED', '오류 센터 초기 렌더 생략', {}, error);
  });
  isInitialized = true;
}
