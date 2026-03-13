/**
 * GEO 검사 탭 UI 렌더링 및 상호작용
 *
 * 책임:
 * - 검사 결과 UI 렌더링 (점수, 체크리스트, LLM 의견)
 * - 사용자 이벤트 처리 (검사 시작, 새로고침)
 * - 로딩/에러 상태 관리
 */

import { groupChecklistByCategory } from './geo-checklist.js';
import { buildAuditAssessment } from './geo-audit.js';
import { ACTIONS } from './constants.js';
import { escapeHtml, renderTooltipIcon } from './panel-dom.js';
import { ensurePageContentScript, showToast } from './ui-utils.js';

const CATEGORY_COPY = {
  seo: {
    title: '검색 기본요소 점검',
    meta: 'SEO 관점',
    inline: '검색 기본요소'
  },
  aeo: {
    title: 'AI 답변 기본요소 점검',
    meta: 'AEO 관점',
    inline: 'AI 답변 기본요소'
  },
  geo: {
    title: 'AI 노출 기본요소 점검',
    meta: 'GEO 관점',
    inline: 'AI 노출 기본요소'
  }
};

function getCategoryTitle(category) {
  const copy = CATEGORY_COPY[category];
  return copy ? `${copy.title} (${copy.meta})` : String(category || '').toUpperCase();
}

function renderCategoryScoreLabel(category) {
  const copy = CATEGORY_COPY[category];
  if (!copy) {
    return String(category || '').toUpperCase();
  }

  return `${copy.title}<span class="score-label-meta">(${copy.meta})</span>`;
}

function renderScoreDetail(scores) {
  return ['seo', 'aeo', 'geo']
    .map((category) => `${CATEGORY_COPY[category].inline}: ${Number.isFinite(scores?.[category]) ? scores[category] : '해당 없음'}`)
    .join(' | ');
}

function renderScoreCardShell(contentHtml) {
  return `
    <div class="geo-panel-card-title">점검 결과</div>
    ${contentHtml}
  `;
}

function getDifferenceBannerText(assessment) {
  if (!assessment?.diffCount) {
    return '봇과 브라우저 결과가 일치합니다';
  }

  if (assessment.hasOnlyLowSignalDifferences && assessment.scoreGap <= 3) {
    return '낮은 우선순위 스타일 항목에서만 작은 차이가 있습니다';
  }

  if (assessment.diffCount === 1 && assessment.scoreGap <= 3) {
    return '현재 차이는 작지만 일부 요소가 JS 실행 후에만 보입니다';
  }

  if (assessment.diffCount <= 2 && assessment.scoreGap <= 7) {
    return '일부 요소가 초기 HTML에 바로 노출되지 않습니다';
  }

  if (assessment.diffCount <= 4 && assessment.scoreGap <= 15) {
    return '초기 HTML과 브라우저 차이가 눈에 띕니다';
  }

  return '렌더링 의존도가 높아 검색봇이 핵심 요소를 놓칠 수 있습니다';
}

function renderDifferenceBanner(assessment) {
  if (!assessment?.diffCount) {
    return '<div class="geo-diff-success">✅ 봇과 브라우저 결과가 일치합니다</div>';
  }

  return `<div class="geo-diff-warning">⚠️ <strong>차이점 ${assessment.diffCount}개 발견</strong>: ${getDifferenceBannerText(assessment)}</div>`;
}

function renderScoreComparison(assessment) {
  const botResult = assessment.primaryResult;
  const clientResult = assessment.secondaryResult;

  if (!botResult || !clientResult) {
    return '';
  }

  return `
    <div class="geo-score-comparison">
      <h3>📊 점수 비교</h3>
      <div class="geo-score-context">페이지 유형: ${escapeHtml(assessment.pageProfile?.label || '일반 페이지')} · 제외 항목 ${assessment.skippedCount || 0}개</div>
      <div class="geo-score-row">
        <div class="geo-score-col">
          <div class="geo-score-label">🤖 봇 (초기 HTML)</div>
          <div class="geo-score-value ${botResult.scores.total < 50 ? 'low' : ''}">
            ${botResult.scores.total}/100
          </div>
          <div class="geo-score-detail">
            ${renderScoreDetail(botResult.scores)}
          </div>
        </div>
        <div class="geo-score-col">
          <div class="geo-score-label">👤 브라우저 (JS 실행 후)</div>
          <div class="geo-score-value ${clientResult.scores.total < 50 ? 'low' : ''}">
            ${clientResult.scores.total}/100
          </div>
          <div class="geo-score-detail">
            ${renderScoreDetail(clientResult.scores)}
          </div>
        </div>
      </div>
      ${assessment.diffCount > 0 ? `<div class="geo-score-gap">
        <span class="geo-gap-icon">📉</span>
        <span class="geo-gap-text">${assessment.scoreGap}점 차이</span>
        <span class="geo-gap-hint">→ ${escapeHtml(assessment.differenceSummary)}</span>
      </div>` : ''}
    </div>
  `;
}

/**
 * 전역 검사 상태 플래그
 * - 동시에 여러 탭에서 검사 시작하는 것을 방지
 * - Window-Level 패널이므로 전역으로 관리 필요
 */
let isAuditRunning = false;

/**
 * 토스트 메시지 표시 함수
 * @param {string} message - 메시지 내용
 * @param {string} type - 메시지 타입 ('success', 'error', 'info')
 */
/**
 * GEO 탭 초기화
 * - HTML 요소 캐시
 * - 이벤트 리스너 등록
 *
 * @param {Object} config - 설정 객체
 * @param {Function} config.onStartAudit - 검사 시작 콜백
 * @param {Function} config.getLogger - 로거 함수
 */
export function initGeoTab(config = {}) {
  const {
    onStartAudit = () => {},
    getLogger = console.log
  } = config;

  // UI 요소 캐시
  const elements = {
    tab: document.getElementById('geoTab'),
    container: document.getElementById('geoContainer'),
    runButton: document.getElementById('geoRunAuditBtn'),
    introNote: document.getElementById('geoIntroNote'),
    resultSection: document.getElementById('geoResultSection'),
    scoreCard: document.getElementById('geoScoreCard'),
    checklistContainer: document.getElementById('geoChecklistContainer'),
    improvementSection: document.getElementById('geoImprovementSection'),
    loadingSpinner: document.getElementById('geoLoadingSpinner'),
    errorMessage: document.getElementById('geoErrorMessage')
  };

  // 이벤트 리스너
  elements.runButton?.addEventListener('click', async () => {
    await handleRunAudit(elements, getLogger, onStartAudit);
  });

  return {
    elements,
    show: () => showGeoTab(elements),
    hide: () => hideGeoTab(elements),
    displayResult: (result) => displayAuditResult(elements, result),
    displayDualResult: (dualResult, improvement) => displayDualAuditResult(elements, dualResult, improvement),
    displayError: (error) => displayError(elements, error),
    displayLoading: (isLoading) => displayLoading(elements, isLoading)
  };
}

/**
 * 검사 시작 핸들러 (Dual Audit 실행)
 *
 * @param {Object} elements - UI 요소 맵
 * @param {Function} getLogger - 로거 함수
 * @param {Function} onStartAudit - 검사 시작 콜백
 */
async function handleRunAudit(elements, getLogger, onStartAudit) {
  // 이미 검사가 진행 중이면 중단 (race condition 방지)
  if (isAuditRunning) {
    showToast('⚠️ 이미 다른 탭에서 검사가 진행 중입니다', 'error');
    getLogger('⚠️ 검사 중복 실행 방지: 이미 검사 진행 중');
    return;
  }

  isAuditRunning = true;
  displayLoading(elements, true);
  displayError(elements, '');

  try {
    // 현재 탭 URL 가져오기
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    const currentUrl = currentTab?.url;
    const tabId = currentTab?.id;

    if (!currentUrl || !tabId) {
      throw new Error('현재 탭 정보를 찾을 수 없습니다');
    }

    // http/https만 지원
    if (!currentUrl.startsWith('http://') && !currentUrl.startsWith('https://')) {
      throw new Error('http/https URL만 지원합니다 (현재: ' + currentUrl.split(':')[0] + ')');
    }

    // Content Script 주입 확인 (PING 테스트, 3초 타임아웃)
    getLogger('Content Script 확인 중...');
    let needsInjection = false;

    try {
      await new Promise((resolve, reject) => {
        // 타임아웃 3초
        const timeout = setTimeout(() => {
          reject(new Error('PING timeout (3초 초과)'));
        }, 3000);

        chrome.tabs.sendMessage(tabId, { type: ACTIONS.PING }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            // "Receiving end does not exist" 등의 에러 → 주입 필요
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      getLogger('✅ Content Script 이미 주입됨');
    } catch (error) {
      // Content Script 미주입 또는 타임아웃 → 자동 주입
      getLogger(`Content Script 미주입 (${error.message}), 자동 주입 시작...`);
      needsInjection = true;
    }

    if (needsInjection) {
      try {
        await ensurePageContentScript(tabId);
        getLogger('✅ Content Script 주입 완료');
        // 주입 후 안정화 대기
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (injectError) {
        throw new Error('Content Script 주입 실패: ' + injectError.message);
      }
    }

    // 콜백 실행
    await onStartAudit();

    // Dual Audit 실행
    getLogger('🔍 GEO Dual Audit 시작...');
    const {
      runDualAudit,
      logAuditResult,
      getExecutiveSummary,
      getPriorityActions,
      getExecutionPlan
    } = await import('./geo-audit.js');

    const dualResult = await runDualAudit(currentUrl, {
      tabId,
      expectedUrl: currentUrl
    });

    // 결과 기록 (봇 기준)
    getLogger('🤖 봇 검사 결과:');
    logAuditResult(dualResult.botResult);
    getLogger('👤 브라우저 검사 결과:');
    logAuditResult(dualResult.clientResult);
    getLogger(`⚠️ 차이점: ${dualResult.differences.length}개`);

    displayLoading(elements, false); // 로딩 스피너 제거

    // ✅ 1단계: 검사 결과 즉시 표시 (애니메이션 없이)
    displayDualAuditResult(elements, dualResult);

    // ✅ 2단계: AI 분석 섹션 준비
    const aiSectionContainer = createAISectionContainer(elements);
    if (!aiSectionContainer) {
      getLogger('⚠️ AI 분석 섹션 생성 실패');
      return;
    }

    const strengthsSection = aiSectionContainer.querySelector('#geoAiStrengths');
    const improvementsSection = aiSectionContainer.querySelector('#geoAiImprovements');
    const roadmapSection = aiSectionContainer.querySelector('#geoAiRoadmap');

    if (!strengthsSection || !improvementsSection || !roadmapSection) {
      getLogger('⚠️ AI 분석 하위 섹션을 찾을 수 없습니다');
      return;
    }

    // 토스트 메시지 표시
    showToast('🤖 AI 해석을 준비 중입니다...', 'info');

    // AI 분석 로딩 표시
    strengthsSection.innerHTML = '<p class="geo-ai-status">현황 해석 정리 중...</p>';
    improvementsSection.innerHTML = '<p class="geo-ai-status">우선순위 액션 정리 중...</p>';
    roadmapSection.innerHTML = '<p class="geo-ai-status">실행 계획 정리 중...</p>';

    // ✅ 3단계: AI 요청 3개 병렬 실행
    getLogger('💡 AI 분석 3개 병렬 실행 중...');
    const aiPromises = [
      getExecutiveSummary(dualResult).catch(err => ({ error: err.message })),
      getPriorityActions(dualResult).catch(err => ({ error: err.message })),
      getExecutionPlan(dualResult).catch(err => ({ error: err.message }))
    ];

    // ✅ 4단계: AI 응답 도착 시 표시
    try {
      const [strengths, improvements, roadmap] = await Promise.all(aiPromises);

      // 강점
      if (strengths && !strengths.error) {
        strengthsSection.innerHTML = renderExecutiveSummary(strengths);
        getLogger('✅ 현황 해석 완료');
      } else {
        strengthsSection.innerHTML = `<p class="geo-ai-status is-error">⚠️ ${escapeHtml(strengths?.error || '분석 실패')}</p>`;
      }

      // 개선사항
      if (improvements && !improvements.error) {
        improvementsSection.innerHTML = renderPriorityActions(improvements);
        getLogger('✅ 우선순위 액션 정리 완료');
      } else {
        improvementsSection.innerHTML = `<p class="geo-ai-status is-error">⚠️ ${escapeHtml(improvements?.error || '분석 실패')}</p>`;
      }

      // 로드맵
      if (roadmap && !roadmap.error) {
        roadmapSection.innerHTML = renderExecutionPlan(roadmap);
        getLogger('✅ 실행 계획 정리 완료');
      } else {
        roadmapSection.innerHTML = `<p class="geo-ai-status is-error">⚠️ ${escapeHtml(roadmap?.error || '분석 실패')}</p>`;
      }

    } catch (error) {
      getLogger('⚠️ AI 분석 실패: ' + error.message);
    }

    getLogger('✅ GEO Dual Audit 완료');
  } catch (error) {
    getLogger('❌ 검사 실패: ' + error.message);
    displayError(elements, error.message);
  } finally {
    isAuditRunning = false;  // 검사 종료, 다른 탭에서 검사 가능
    displayLoading(elements, false);
  }
}

/**
 * AI 분석 섹션 컨테이너 생성
 * 3개 섹션을 가진 컨테이너를 improvementSection에 삽입
 */
function createAISectionContainer(elements) {
  if (!elements || !elements.improvementSection) {
    console.error('improvementSection element not found');
    return null;
  }

  const html = `
    <div class="geo-ai-analysis geo-panel-card card">
      <div class="geo-panel-card-title">AI 해석</div>

      <div class="geo-ai-section">
        <h4>현황 해석</h4>
        <div id="geoAiStrengths" class="geo-ai-content"></div>
      </div>

      <div class="geo-ai-section">
        <h4>우선순위 액션</h4>
        <div id="geoAiImprovements" class="geo-ai-content"></div>
      </div>

      <div class="geo-ai-section">
        <h4>실행 계획</h4>
        <div id="geoAiRoadmap" class="geo-ai-content"></div>
      </div>
    </div>
  `;

  elements.improvementSection.innerHTML = html;
  return elements.improvementSection.querySelector('.geo-ai-analysis');
}

function renderGeoAiList(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  return `<ul class="geo-ai-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderExecutiveSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return formatMarkdownToHtml(String(summary || ''));
  }

  const hasStructuredContent = summary.statusLine || (Array.isArray(summary.causes) && summary.causes.length) || summary.differenceInterpretation;
  if (!hasStructuredContent) {
    return formatMarkdownToHtml(summary.rawText || '');
  }

  return `
    <div class="geo-ai-summary-card">
      ${summary.statusLine ? `<p class="geo-ai-summary-line">${escapeHtml(summary.statusLine)}</p>` : ''}
      ${Array.isArray(summary.causes) && summary.causes.length ? `
        <div class="geo-ai-block">
          <div class="geo-ai-block-label">핵심 원인</div>
          ${renderGeoAiList(summary.causes)}
        </div>
      ` : ''}
      ${summary.differenceInterpretation ? `
        <div class="geo-ai-block">
          <div class="geo-ai-block-label">봇/브라우저 해석</div>
          <p>${escapeHtml(summary.differenceInterpretation)}</p>
        </div>
      ` : ''}
    </div>
  `;
}

function renderPriorityActions(actionsData) {
  if (!actionsData || typeof actionsData !== 'object') {
    return formatMarkdownToHtml(String(actionsData || ''));
  }

  if (!Array.isArray(actionsData.actions) || actionsData.actions.length === 0) {
    return formatMarkdownToHtml(actionsData.rawText || '');
  }

  return `
    <div class="geo-ai-action-stack">
      ${actionsData.actions.map((action, index) => `
        <div class="geo-ai-action-card">
          <div class="geo-ai-action-head">
            <span class="geo-ai-action-index">${index + 1}</span>
            <span class="geo-ai-action-title">${escapeHtml(action.title || '')}</span>
          </div>
          ${action.reason ? `<p class="geo-ai-action-reason">${escapeHtml(action.reason)}</p>` : ''}
          ${Array.isArray(action.tasks) && action.tasks.length ? `
            <div class="geo-ai-block">
              <div class="geo-ai-block-label">지금 할 일</div>
              ${renderGeoAiList(action.tasks)}
            </div>
          ` : ''}
          ${action.whyNow ? `
            <div class="geo-ai-block">
              <div class="geo-ai-block-label">우선순위 근거</div>
              <p>${escapeHtml(action.whyNow)}</p>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function renderExecutionPlan(planData) {
  if (!planData || typeof planData !== 'object') {
    return formatMarkdownToHtml(String(planData || ''));
  }

  const sections = [
    { label: '오늘', items: planData.today },
    { label: '이번 주', items: planData.thisWeek },
    { label: '이후', items: planData.later }
  ].filter((section) => Array.isArray(section.items) && section.items.length > 0);

  if (sections.length === 0) {
    return formatMarkdownToHtml(planData.rawText || '');
  }

  return `
    <div class="geo-ai-plan-grid">
      ${sections.map((section) => `
        <div class="geo-ai-plan-card">
          <div class="geo-ai-block-label">${section.label}</div>
          ${renderGeoAiList(section.items)}
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * 검사 결과 렌더링
 *
 * @param {Object} elements - UI 요소 맵
 * @param {AuditResult} auditResult - 검사 결과
 * @param {string} improvement - LLM 개선 의견
 */
function displayAuditResult(elements, auditResult, improvement = '') {
  if (!elements.resultSection) return;

  const { scores, results, passedCount, failedCount } = auditResult;

  // 1. 점수 카드 렌더링
  elements.scoreCard.innerHTML = renderScoreCardShell(`
    <div class="geo-scores">
      <div class="geo-score-item total">
        <div class="score-value">${scores.total}</div>
        <div class="score-label">총점</div>
      </div>
      <div class="geo-score-item seo">
        <div class="score-value">${Number.isFinite(scores.seo) ? scores.seo : '제외'}</div>
        <div class="score-label">${renderCategoryScoreLabel('seo')}</div>
      </div>
      <div class="geo-score-item aeo">
        <div class="score-value">${Number.isFinite(scores.aeo) ? scores.aeo : '제외'}</div>
        <div class="score-label">${renderCategoryScoreLabel('aeo')}</div>
      </div>
      <div class="geo-score-item geo">
        <div class="score-value">${Number.isFinite(scores.geo) ? scores.geo : '제외'}</div>
        <div class="score-label">${renderCategoryScoreLabel('geo')}</div>
      </div>
    </div>
    <div class="geo-score-summary">
      <span>✅ 통과: ${passedCount}개</span>
      <span>❌ 실패: ${failedCount}개</span>
      <span>⏭️ 제외: ${auditResult.skippedCount || 0}개</span>
    </div>
  `);

  // 2. 체크리스트 렌더링 (카테고리별)
  const grouped = groupChecklistByCategory();
  let checklistHtml = '';

  Object.entries(grouped).forEach(([category, items]) => {
    const categoryResults = results.filter(r => r.category === category && r.applicable !== false);
    if (categoryResults.length === 0) {
      return;
    }
    const categoryLabel = getCategoryTitle(category);

    checklistHtml += `<div class="geo-category">
      <h3 class="geo-category-title">${categoryLabel}</h3>
      <div class="geo-items">
        ${categoryResults.map(result => renderCheckItem(result)).join('')}
      </div>
    </div>`;
  });

  elements.checklistContainer.innerHTML = checklistHtml;

  // 3. LLM 의견 렌더링
  if (improvement && elements.improvementSection) {
    const formattedHtml = formatImprovement(improvement);
    elements.improvementSection.innerHTML = `
      <div class="geo-improvement">
        <h3>💡 AI 개선 의견</h3>
        ${formattedHtml}
      </div>
    `;
  } else if (elements.improvementSection) {
    elements.improvementSection.innerHTML = '';
  }

  // 결과 섹션 표시
  elements.resultSection.style.display = 'block';
}

/**
 * Dual Audit 결과 렌더링 (봇 vs 브라우저)
 *
 * @param {Object} elements - UI 요소 맵
 * @param {Object} dualResult - runDualAudit()의 결과
 * @param {string} improvement - LLM 개선 의견 (선택)
 */
function displayDualAuditResult(elements, dualResult, improvement = '') {
  if (!elements.resultSection) return;

  const { botResult, clientResult, differences } = dualResult;
  const assessment = buildAuditAssessment(dualResult);

  // 차이점 경고
  const diffWarning = renderDifferenceBanner(assessment);
  const scoreComparison = renderScoreComparison(assessment);

  // 항목별 나란히 비교
  const grouped = groupChecklistByCategory();
  let comparisonHtml = '<div class="geo-dual-comparison">';

  Object.entries(grouped).forEach(([category, items]) => {
    const applicableItems = items.filter((item) => {
      const botItem = botResult.results.find((result) => result.id === item.id);
      const clientItem = clientResult.results.find((result) => result.id === item.id);
      return botItem?.applicable !== false || clientItem?.applicable !== false;
    });

    if (applicableItems.length === 0) {
      return;
    }

    const categoryLabel = getCategoryTitle(category);
    comparisonHtml += `<div class="geo-category">
      <h3 class="geo-category-title">${categoryLabel}</h3>
      <div class="geo-items">`;

    // 각 항목을 weight 높은 순으로 정렬
    const sortedItems = [...applicableItems].sort((a, b) => b.weight - a.weight);

    // 각 항목별로 봇/브라우저 나란히 표시
    sortedItems.forEach(item => {
      const botItem = botResult.results.find(r => r.id === item.id);
      const clientItem = clientResult.results.find(r => r.id === item.id);
      if (!botItem || !clientItem) {
        return;
      }
      const isDifferent = differences.some(d => d.id === item.id);

      comparisonHtml += renderDualCheckItem(botItem, clientItem, isDifferent, item.tooltip);
    });

    comparisonHtml += `</div></div>`;
  });

  comparisonHtml += '</div>';

  // 전체 조합
  elements.scoreCard.innerHTML = renderScoreCardShell(diffWarning + scoreComparison);
  elements.checklistContainer.innerHTML = comparisonHtml;

  // improvementSection은 건드리지 않음 (handleRunAudit에서 AI 섹션 추가)

  // 결과 섹션 표시
  elements.resultSection.style.display = 'block';
}

/**
 * 개별 체크 항목 렌더링
 *
 * 표시 내용:
 * - 체크 결과 (✅/❌)
 * - 항목 제목
 * - 가중치
 * - 상세 설명 (description) - SSR/CSR 주의사항 포함
 * - 실패 항목: 개선 방법 (hint)
 *
 * @param {CheckResult} result - 체크 결과
 * @param {Array} differences - 차이점 목록 (선택, Dual Audit 시)
 * @returns {string} HTML 문자열
 */
function renderCheckItem(result, differences = []) {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'passed' : 'failed';

  // 차이점 강조 (빨간색)
  const isDifferent = differences.some(d => d.id === result.id);
  const diffClass = isDifferent ? 'geo-item-diff' : '';
  const diffBadge = isDifferent ? '<span class="geo-diff-badge">⚠️ 차이</span>' : '';

  // description의 \n을 <br>로 변환하여 줄바꿈 표시
  const formattedDescription = result.description
    ? result.description.split('\n').map(line => {
        // 불릿 항목 (- 로 시작)을 보기 좋게 포맷팅
        if (line.trim().startsWith('-')) {
          return `<div class="geo-item-bullet">${escapeHtml(line)}</div>`;
        }
        // 화살표 (→) 로 시작하는 행동 유도 텍스트
        if (line.trim().startsWith('→')) {
          return `<div class="geo-item-action">${escapeHtml(line)}</div>`;
        }
        // 일반 텍스트
        if (line.trim()) {
          return `<div>${escapeHtml(line)}</div>`;
        }
        // 빈 줄 (단락 구분)
        return '<div class="geo-item-spacer" aria-hidden="true"></div>';
      }).join('')
    : '';

  return `
    <div class="geo-item ${status} ${diffClass}">
      <div class="geo-item-header">
        <span class="geo-item-icon">${icon}</span>
        <span class="geo-item-title">${escapeHtml(result.title)}</span>
        ${diffBadge}
        <span class="geo-item-weight">${escapeHtml(String(result.weight))}pt</span>
      </div>

      <!-- 상세 설명 (SSR/CSR 주의사항 포함) -->
      ${formattedDescription ? `<div class="geo-item-description">${formattedDescription}</div>` : ''}

      <!-- 실패 항목: 개선 방법 -->
      ${!result.passed ? `<div class="geo-item-hint">💡 ${escapeHtml(result.hint)}</div>` : ''}
    </div>
  `;
}

/**
 * Dual Audit용 항목별 비교 렌더링 (봇 vs 브라우저)
 *
 * @param {CheckResult} botItem - 봇 검사 결과
 * @param {CheckResult} clientItem - 브라우저 검사 결과
 * @param {boolean} isDifferent - 차이점 여부
 * @param {string} tooltipText - 툴팁 설명 (선택)
 * @returns {string} HTML 문자열
 */
function renderDualCheckItem(botItem, clientItem, isDifferent, tooltipText = '') {
  const diffClass = isDifferent ? 'geo-item-diff' : '';
  const diffBadge = isDifferent ? '<span class="geo-diff-badge">⚠️ 차이</span>' : '';

  const botIcon = botItem.passed ? '✅' : '❌';
  const clientIcon = clientItem.passed ? '✅' : '❌';

  // 힌트 표시 로직:
  // - 둘 다 실패 시 공통 힌트
  // - 한쪽만 실패 시 해당 영역에만
  // - 통과했지만 특별한 이유(⚠️로 시작)가 있으면 표시
  const bothFailed = !botItem.passed && !clientItem.passed;
  const showCommonHint = bothFailed;
  const showBotHint = (!botItem.passed && !showCommonHint) || (botItem.passed && botItem.hint?.startsWith('⚠️'));
  const showClientHint = (!clientItem.passed && !showCommonHint) || (clientItem.passed && clientItem.hint?.startsWith('⚠️'));

  // 툴팁 (물음표 아이콘)
  const tooltipIcon = tooltipText ? renderTooltipIcon(tooltipText, 'geo-tooltip-icon') : '';

  return `
    <div class="geo-dual-item ${diffClass}">
      <div class="geo-dual-header">
        <span class="geo-item-title">${escapeHtml(botItem.title)}${tooltipIcon}</span>
        ${diffBadge}
        <span class="geo-item-weight">${escapeHtml(String(botItem.weight))}pt</span>
      </div>

      <div class="geo-dual-results">
        <div class="geo-dual-col bot-col">
          <div class="geo-dual-label">🤖 봇</div>
          <div class="geo-dual-status ${botItem.passed ? 'passed' : 'failed'}">
            ${botIcon} ${botItem.passed ? '통과' : '실패'} (${botItem.weight}pt)
          </div>
          ${showBotHint ? `<div class="geo-item-hint">💡 ${escapeHtml(botItem.hint)}</div>` : ''}
        </div>

        <div class="geo-dual-col client-col">
          <div class="geo-dual-label">👤 브라우저</div>
          <div class="geo-dual-status ${clientItem.passed ? 'passed' : 'failed'}">
            ${clientIcon} ${clientItem.passed ? '통과' : '실패'} (${clientItem.weight}pt)
          </div>
          ${showClientHint ? `<div class="geo-item-hint">💡 ${escapeHtml(clientItem.hint)}</div>` : ''}
        </div>
      </div>

      ${showCommonHint ? `<div class="geo-item-hint-common">💡 ${escapeHtml(botItem.hint)}</div>` : ''}
    </div>
  `;
}

/**
 * HTML 엔터티를 실제 문자로 디코딩 (이미 &lt;&gt;로 인코딩된 코드 표시용)
 * LLM이 보낸 &lt;meta&gt;를 <meta>로 변환하여 pre/code에 표시
 *
 * @param {string} text - HTML 엔터티로 인코딩된 텍스트
 * @returns {string} 디코딩된 텍스트
 *
 * @example
 * decodeHtmlEntities('&lt;meta name=&quot;description&quot;&gt;')
 * // '<meta name="description">'
 */
function decodeHtmlEntities(text) {
  if (!text) return text;
  // 역순으로 처리 (& 먼저 처리하면 &lt;가 꼬임)
  let result = text;
  result = result.replace(/&quot;/g, '"');
  result = result.replace(/&#039;/g, "'");
  result = result.replace(/&lt;/g, '<');
  result = result.replace(/&gt;/g, '>');
  result = result.replace(/&amp;/g, '&');
  return result;
}

function renderInlineMarkdown(text) {
  const inlineCodes = [];
  let processed = decodeHtmlEntities(String(text || ''));

  processed = processed.replace(/`([^`\n]+)`/g, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  processed = escapeHtml(processed)
    .replace(/\*\*([^*][\s\S]*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n][\s\S]*?)\*/g, '<em>$1</em>');

  inlineCodes.forEach((html, index) => {
    processed = processed.replace(`__INLINE_CODE_${index}__`, html);
  });

  return processed;
}

function renderMarkdownBlock(block) {
  const lines = String(block || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, items) => line || items.length === 1);

  if (lines.length === 1 && lines[0] === '---') {
    return '<hr class="geo-improvement-hr">';
  }

  if (lines.length === 1 && lines[0].startsWith('### ')) {
    return `<h4 class="geo-improvement-h4">${renderInlineMarkdown(lines[0].slice(4))}</h4>`;
  }

  if (lines.length === 1 && lines[0].startsWith('## ')) {
    return `<h3 class="geo-improvement-h3">${renderInlineMarkdown(lines[0].slice(3))}</h3>`;
  }

  const listItems = lines.filter((line) => line.startsWith('- '));
  const hasOnlyList = listItems.length === lines.length && listItems.length > 0;
  const hasIntroPlusList = listItems.length === lines.length - 1 && lines[0] && !lines[0].startsWith('- ');

  if (hasOnlyList || hasIntroPlusList) {
    const intro = hasIntroPlusList ? `<p>${renderInlineMarkdown(lines[0])}</p>` : '';
    const items = (hasOnlyList ? lines : lines.slice(1))
      .filter((line) => line.startsWith('- '))
      .map((line) => `<li>${renderInlineMarkdown(line.replace(/^-\s*/, ''))}</li>`)
      .join('\n');

    return `${intro}<ul class="geo-improvement-list">\n${items}\n</ul>`;
  }

  return `<p>${lines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`;
}

/**
 * 마크다운을 HTML로 변환 (향상된 버전 - 코드 블록 지원)
 *
 * @param {string} markdown - 마크다운 텍스트
 * @returns {string} HTML 문자열
 */
function formatMarkdownToHtml(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  // 1. 코드 블록 추출 (```...```)
  const codeBlocks = [];
  const normalizedMarkdown = String(markdown || '').replace(/\r\n?/g, '\n');
  let processedMd = normalizedMarkdown.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || 'plaintext', code: decodeHtmlEntities(code).trim() });
    return placeholder;
  });

  // 2. 기본 마크다운 변환
  let html = processedMd
    .split('\n\n')
    .map((para) => {
      const normalizedBlock = para.trim();
      if (!normalizedBlock) {
        return '';
      }

      // 코드 블록 플레이스홀더는 그대로
      if (/^__CODE_BLOCK_\d+__$/.test(normalizedBlock)) {
        return normalizedBlock;
      }

      return renderMarkdownBlock(normalizedBlock);
    })
    .join('\n');

  // 3. 코드 블록 복원
  codeBlocks.forEach((block, idx) => {
    const placeholder = `__CODE_BLOCK_${idx}__`;
    const escapedCode = escapeHtml(block.code);
    const codeHtml = `<pre><code class="language-${block.lang}">${escapedCode}</code></pre>`;
    html = html.replace(placeholder, codeHtml);
  });

  return `<div class="geo-improvement-content">${html}</div>`;
}

/**
 * @deprecated 기존 formatImprovement는 하위 호환을 위해 유지
 */
function formatImprovement(markdown) {
  return formatMarkdownToHtml(markdown);
}

/**
 * 로딩 상태 표시
 *
 * @param {Object} elements - UI 요소 맵
 * @param {boolean} isLoading - 로딩 중 여부
 */
function displayLoading(elements, isLoading) {
  if (!elements.loadingSpinner) return;

  if (isLoading) {
    elements.loadingSpinner.style.display = 'flex';
    elements.resultSection.style.display = 'none';
    elements.runButton.disabled = true;
    if (elements.introNote) {
      elements.introNote.style.display = 'none';
    }
  } else {
    elements.loadingSpinner.style.display = 'none';
    elements.runButton.disabled = false;
    if (elements.introNote) {
      const hasResult = elements.resultSection?.style.display === 'block';
      const hasError = elements.errorMessage?.style.display === 'block';
      elements.introNote.style.display = hasResult || hasError ? 'none' : 'block';
    }
  }
}

/**
 * 에러 메시지 표시
 *
 * @param {Object} elements - UI 요소 맵
 * @param {string} message - 에러 메시지
 */
function displayError(elements, message) {
  if (!elements.errorMessage) return;

  if (message) {
    elements.errorMessage.textContent = `❌ ${message}`;
    elements.errorMessage.style.display = 'block';
  } else {
    elements.errorMessage.style.display = 'none';
  }
}

/**
 * GEO 탭 표시
 *
 * @param {Object} elements - UI 요소 맵
 */
function showGeoTab(elements) {
  if (elements.tab) elements.tab.style.display = 'block';
}

/**
 * GEO 탭 숨김
 *
 * @param {Object} elements - UI 요소 맵
 */
function hideGeoTab(elements) {
  if (elements.tab) elements.tab.style.display = 'none';
}

/**
 * 툴팁 이벤트 핸들러 초기화
 *
 * 마우스 오버 시 툴팁을 마우스 위치 근처에 표시하며,
 * 화면 경계를 벗어나지 않도록 자동 조정합니다.
 */
export function initTooltipHandlers() {
  let tooltipElement = null;

  // 툴팁 생성 (한 번만)
  const createTooltip = () => {
    if (tooltipElement) return tooltipElement;

    tooltipElement = document.createElement('div');
    tooltipElement.className = 'geo-tooltip-popup';
    tooltipElement.style.cssText = `
      position: fixed;
      z-index: 10000;
      background: #1a1a1a;
      color: #edeef0;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.5;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      display: none;
      word-wrap: break-word;
    `;
    document.body.appendChild(tooltipElement);
    return tooltipElement;
  };

  // 툴팁 표시
  const showTooltip = (text, x, y) => {
    const tooltip = createTooltip();
    tooltip.textContent = text;
    tooltip.style.display = 'block';

    // 툴팁 크기 측정
    const rect = tooltip.getBoundingClientRect();
    const padding = 10; // 마우스 커서와의 거리

    // 기본 위치: 마우스 오른쪽 아래
    let left = x + padding;
    let top = y + padding;

    // 오른쪽 경계를 벗어나면 왼쪽으로 이동
    if (left + rect.width > window.innerWidth) {
      left = x - rect.width - padding;
    }

    // 아래쪽 경계를 벗어나면 위쪽으로 이동
    if (top + rect.height > window.innerHeight) {
      top = y - rect.height - padding;
    }

    // 왼쪽 경계 체크
    if (left < 0) {
      left = padding;
    }

    // 위쪽 경계 체크
    if (top < 0) {
      top = padding;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  // 툴팁 숨김
  const hideTooltip = () => {
    if (tooltipElement) {
      tooltipElement.style.display = 'none';
    }
  };

  // 이벤트 위임 (동적으로 생성되는 요소에도 작동)
  document.addEventListener('mouseover', (e) => {
    const icon = e.target.closest('.geo-tooltip-icon');
    if (icon) {
      const text = icon.getAttribute('data-tooltip');
      if (text) {
        showTooltip(text, e.clientX, e.clientY);
      }
    }
  });

  document.addEventListener('mouseout', (e) => {
    const icon = e.target.closest('.geo-tooltip-icon');
    if (icon) {
      hideTooltip();
    }
  });

  // 마우스 이동 시 툴팁 위치 업데이트
  document.addEventListener('mousemove', (e) => {
    const icon = e.target.closest('.geo-tooltip-icon');
    if (icon && tooltipElement && tooltipElement.style.display === 'block') {
      const text = icon.getAttribute('data-tooltip');
      showTooltip(text, e.clientX, e.clientY);
    }
  });
}
