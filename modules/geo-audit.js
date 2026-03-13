/**
 * GEO (Generative Engine Optimization) 검사 엔진
 *
 * 책임:
 * - 체크리스트 기반 페이지 자동 검사
 * - 카테고리별 점수 계산
 * - LLM에 검사 결과 전송 → 개선 의견 수집
 *
 * 데이터 흐름:
 * 1. runAudit() → 체크리스트 순회 (자동)
 * 2. calculateScores() → 점수 계산 (if 없음, 수식만)
 * 3. getImprovement() → LLM 의견 수집
 */

import { GEO_CHECKLIST, detectGeoPageProfile, matchGeoProfiles } from './geo-checklist.js';
import { ACTIONS } from './constants.js';
import { getGeoAuditConfig } from './storage.js';
import { runPrompt } from './provider-client.js';

const CRITICAL_FAILURE_IDS = [
  'title_tag',
  'meta_description',
  'structured_data',
  'og_title',
  'og_description',
  'og_image',
  'twitter_card',
  'faq_schema',
  'author_info',
  'publish_date',
  'source_attribution',
  'breadcrumb_schema'
];

const LOW_SIGNAL_DIFFERENCE_IDS = ['media_queries'];

const PRIORITY_ORDER_BY_PROFILE = {
  generic: [
    'structured_data',
    'og_title',
    'og_description',
    'og_image',
    'twitter_card',
    'clear_summary',
    'breadcrumb_schema',
    'faq_schema'
  ],
  article: [
    'structured_data',
    'author_info',
    'publish_date',
    'source_attribution',
    'og_title',
    'og_description',
    'og_image',
    'twitter_card',
    'breadcrumb_schema',
    'faq_schema'
  ],
  product: [
    'structured_data',
    'og_title',
    'og_description',
    'og_image',
    'twitter_card',
    'faq_schema',
    'clear_summary',
    'breadcrumb_schema'
  ],
  landing: [
    'og_title',
    'og_description',
    'og_image',
    'twitter_card',
    'structured_data',
    'clear_summary',
    'faq_schema'
  ],
  login: [
    'title_tag',
    'meta_description',
    'h1_tag'
  ]
};

const KEY_SIGNAL_IDS = [
  'title_tag',
  'meta_description',
  'h1_tag',
  'structured_data',
  'clear_summary',
  'headings_structure'
];

const SEVERITY_COPY = {
  critical: '위험',
  weak: '부족',
  fair: '보통',
  strong: '양호'
};

function normalizeAuditInput(input) {
  if (input?.botResult && input?.clientResult) {
    return {
      primaryResult: input.botResult,
      secondaryResult: input.clientResult,
      differences: Array.isArray(input.differences) ? input.differences : []
    };
  }

  return {
    primaryResult: input,
    secondaryResult: null,
    differences: []
  };
}

function getSeverityFromScores(scores = {}) {
  const total = Number(scores.total || 0);
  const categoryValues = ['seo', 'aeo', 'geo']
    .map((key) => scores[key])
    .filter((value) => Number.isFinite(value));
  const minCategory = categoryValues.length > 0 ? Math.min(...categoryValues) : total;

  if (total < 40 || minCategory < 25) {
    return 'critical';
  }

  if (total < 60 || minCategory < 45) {
    return 'weak';
  }

  if (total < 80 || minCategory < 65) {
    return 'fair';
  }

  return 'strong';
}

function getWeakCategories(scores = {}) {
  return [
    { key: 'seo', label: '검색 기본요소', score: Number.isFinite(scores.seo) ? Number(scores.seo) : null },
    { key: 'aeo', label: 'AI 답변 기본요소', score: Number.isFinite(scores.aeo) ? Number(scores.aeo) : null },
    { key: 'geo', label: 'AI 노출 기본요소', score: Number.isFinite(scores.geo) ? Number(scores.geo) : null }
  ]
    .filter((item) => Number.isFinite(item.score) && item.score < 45)
    .sort((left, right) => left.score - right.score);
}

function getPriorityFailures(results = [], pageProfileType = 'generic') {
  const profileOrder = PRIORITY_ORDER_BY_PROFILE[pageProfileType] || CRITICAL_FAILURE_IDS;
  return results
    .filter((item) => item && item.applicable !== false && item.passed === false)
    .sort((left, right) => {
      const leftPriority = profileOrder.indexOf(left.id);
      const rightPriority = profileOrder.indexOf(right.id);
      const normalizedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const normalizedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

      if (normalizedLeft !== normalizedRight) {
        return normalizedLeft - normalizedRight;
      }

      const leftCritical = CRITICAL_FAILURE_IDS.indexOf(left.id);
      const rightCritical = CRITICAL_FAILURE_IDS.indexOf(right.id);
      const normalizedLeftCritical = leftCritical === -1 ? Number.MAX_SAFE_INTEGER : leftCritical;
      const normalizedRightCritical = rightCritical === -1 ? Number.MAX_SAFE_INTEGER : rightCritical;

      if (normalizedLeftCritical !== normalizedRightCritical) {
        return normalizedLeftCritical - normalizedRightCritical;
      }

      return (right.weight || 0) - (left.weight || 0);
    });
}

function getPassedSignals(results = []) {
  return results
    .filter((item) => item && item.applicable !== false && item.passed === true && KEY_SIGNAL_IDS.includes(item.id))
    .map((item) => item.title);
}

function formatScoreForPrompt(value) {
  return Number.isFinite(value) ? `${value}` : '해당 없음';
}

function formatScoreLabel(value) {
  return Number.isFinite(value) ? `${value}/100` : '해당 없음';
}

function getDifferenceSummary(differences = [], scoreGap) {
  const diffCount = differences.length;
  if (!diffCount) {
    return '봇과 브라우저 결과 차이는 없습니다.';
  }

  const lowSignalOnly = differences.every((difference) => LOW_SIGNAL_DIFFERENCE_IDS.includes(difference.id));
  if (lowSignalOnly && scoreGap <= 3) {
    return '반응형 스타일처럼 낮은 우선순위 항목에서만 작은 차이가 있습니다. 메타나 구조 신호보다 영향이 작습니다.';
  }

  if (diffCount === 1 && scoreGap <= 3) {
    return '봇과 브라우저 차이는 작습니다. 일부 요소만 JS 실행 후에 보입니다.';
  }

  if (diffCount <= 2 && scoreGap <= 7) {
    return '봇과 브라우저에 작은 차이가 있습니다. 일부 요소가 초기 HTML에 바로 노출되지 않습니다.';
  }

  if (diffCount <= 4 && scoreGap <= 15) {
    return '초기 HTML과 브라우저 결과 차이가 눈에 띕니다. 일부 핵심 요소가 JS 실행 후에만 보일 수 있습니다.';
  }

  return '초기 HTML과 브라우저 차이가 큽니다. 렌더링 의존도가 높아 검색봇이 핵심 요소를 놓칠 가능성이 있습니다.';
}

export function buildAuditAssessment(input) {
  const { primaryResult, secondaryResult, differences } = normalizeAuditInput(input);
  const primaryScores = primaryResult?.scores || {};
  const secondaryScores = secondaryResult?.scores || {};
  const diffCount = differences.length;
  const scoreGap = secondaryResult
    ? Math.abs(Number(secondaryScores.total || 0) - Number(primaryScores.total || 0))
    : 0;
  const severity = getSeverityFromScores(primaryScores);
  const weakCategories = getWeakCategories(primaryScores);
  const priorityFailures = getPriorityFailures(primaryResult?.results || [], primaryResult?.pageProfile?.type);
  const passedSignals = getPassedSignals(primaryResult?.results || []);
  const hasOnlyLowSignalDifferences = diffCount > 0 && differences.every((difference) => LOW_SIGNAL_DIFFERENCE_IDS.includes(difference.id));

  return {
    severity,
    severityLabel: SEVERITY_COPY[severity],
    primaryResult,
    secondaryResult,
    differences,
    diffCount,
    scoreGap,
    weakCategories,
    differenceSummary: getDifferenceSummary(differences, scoreGap),
    priorityFailures,
    passedSignals,
    pageProfile: primaryResult?.pageProfile || null,
    skippedCount: Number(primaryResult?.skippedCount || 0),
    applicableCount: Number(primaryResult?.applicableCount || 0),
    hasOnlyLowSignalDifferences
  };
}

/**
 * @typedef {Object} AuditResult
 * GEO 검사의 최종 결과 객체
 *
 * @property {Array<CheckResult>} results - 각 체크 항목별 상세 결과
 * @property {Object} scores - 카테고리별 점수 ({ seo: 0-100, aeo: 0-100, geo: 0-100, total: 0-100 })
 * @property {number} passedCount - 통과한 항목 수 (예: 15)
 * @property {number} failedCount - 실패한 항목 수 (예: 5)
 * @property {Array<string>} failedItems - 실패한 항목 ID 목록 (UI 강조용)
 * @property {string} timestamp - 검사 실행 시간 (ISO 8601 형식)
 *
 * @example
 * // geo-tab.js에서 사용:
 * const auditResult = await runAudit();
 * console.log(auditResult);
 * // {
 * //   results: [ { id: 'title_length', title: '제목 길이', ... }, ... ],
 * //   scores: { seo: 85, aeo: 90, geo: 78, total: 84 },
 * //   passedCount: 15,
 * //   failedCount: 5,
 * //   failedItems: ['title_length', 'meta_description'],
 * //   timestamp: '2025-11-12T10:30:45.123Z'
 * // }
 */

/**
 * @typedef {Object} CheckResult
 * 개별 체크 항목의 검사 결과
 *
 * @property {string} id - 체크 항목 고유 ID (예: 'title_length', 'meta_description')
 * @property {string} title - 항목 제목 (사용자에게 표시할 텍스트)
 * @property {boolean} passed - 통과 여부 (true=✅, false=❌)
 * @property {string} category - 체크 카테고리 ('seo' | 'aeo' | 'geo')
 * @property {number} weight - 점수 가중치 (예: 10, 5, 2)
 * @property {string} hint - 실패 시 개선 팁 (사용자가 읽을 텍스트)
 *
 * @example
 * // geo-checklist.js에서 정의된 항목:
 * {
 *   id: 'title_length',
 *   title: '페이지 제목 길이',
 *   category: 'seo',
 *   weight: 10,
 *   hint: '30-60자 사이의 제목을 사용하세요',
 *   selector: () => document.title,
 *   validator: (title) => title.length >= 30 && title.length <= 60
 * }
 */

/**
 * 페이지 자동 검사 실행
 *
 * 검사 흐름:
 * 1. GEO_CHECKLIST의 각 항목을 순회
 * 2. selector() 실행 → DOM에서 데이터 추출
 * 3. validator() 실행 → 추출한 데이터 검증
 * 4. 점수 계산 → 카테고리별 평점 산출
 *
 * @param {Document} doc - 검사할 DOM 문서 (기본: 현재 document)
 * @returns {Promise<AuditResult>} 검사 완료 결과
 *
 * @example
 * // geo-ui.js에서 호출:
 * const auditResult = await runAudit();
 * console.log(`점수: ${auditResult.scores.total}/100`);
 * console.log(`통과: ${auditResult.passedCount}/${auditResult.results.length}`);
 *
 * // 각 카테고리별 점수 확인:
 * console.log(`SEO: ${auditResult.scores.seo}`);
 * console.log(`AEO: ${auditResult.scores.aeo}`);
 * console.log(`GEO: ${auditResult.scores.geo}`);
 */
export async function runAudit(doc = document, context = {}) {
  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const pageProfile = detectGeoPageProfile(doc, context);

  // 체크리스트 순회 (자동, if 없음)
  for (const checkItem of GEO_CHECKLIST) {
    const applicable = matchGeoProfiles(pageProfile, checkItem.profiles);

    if (!applicable) {
      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed: null,
        applicable: false,
        skipped: true,
        hint: '현재 페이지 유형에서는 점수에서 제외됩니다.'
      });
      skippedCount++;
      continue;
    }

    try {
      // 1. selector 실행 → DOM 요소 또는 데이터 추출
      const selected = checkItem.selector(doc, pageProfile);

      // 2. validator 실행 → pass/fail 결정
      const passed = checkItem.validator(selected, doc, pageProfile, checkItem);

      // 3. 결과 기록
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc, selected, pageProfile) : checkItem.hint;

      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed,
        applicable: true,
        skipped: false,
        hint
      });

      // 통계
      if (passed) passedCount++;
      else failedCount++;
    } catch (error) {
      // selector/validator 에러는 fail 처리
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc, null, pageProfile) : checkItem.hint;

      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed: false,
        applicable: true,
        skipped: false,
        hint,
        error: error.message
      });
      failedCount++;
    }
  }

  // 점수 계산
  const scores = calculateScores(results);

  return {
    results,
    scores,
    passedCount,
    failedCount,
    skippedCount,
    applicableCount: results.filter((result) => result.applicable !== false).length,
    failedItems: results.filter(r => r.applicable !== false && r.passed === false).map(r => r.id),
    pageProfile,
    timestamp: new Date().toISOString()
  };
}

/**
 * 카테고리별 점수 계산 (수식 기반, if 없음)
 *
 * 점수 계산 로직:
 * - 각 항목: (통과 ? 가중치 : 0) / 총 가중치 * 100
 * - 카테고리별: 해당 카테고리 점수만 합산
 * - 총점: 전체 카테고리 평균
 *
 * @param {Array<CheckResult>} results - 검사 결과 (runAudit()의 출력)
 * @returns {Object} { seo: number, aeo: number, geo: number, total: number }
 *
 * @example
 * // runAudit()에서 받은 results 사용:
 * const auditResult = await runAudit();
 * const scores = calculateScores(auditResult.results);
 * console.log(scores); // { seo: 85, aeo: 90, geo: 78, total: 84 }
 */
export function calculateScores(results) {
  const categoryScores = {};
  const applicableWeights = {};

  ['seo', 'aeo', 'geo'].forEach((category) => {
    const categoryItems = results.filter((result) => result.category === category && result.applicable !== false);
    const totalWeight = categoryItems.reduce((sum, result) => sum + Number(result.weight || 0), 0);
    const earnedWeight = categoryItems
      .filter((result) => result.passed === true)
      .reduce((sum, result) => sum + Number(result.weight || 0), 0);

    applicableWeights[category] = totalWeight;
    categoryScores[category] = totalWeight > 0
      ? Math.round((earnedWeight / totalWeight) * 100)
      : null;
  });

  const numericScores = Object.values(categoryScores).filter((score) => Number.isFinite(score));
  const totalScore = numericScores.length > 0
    ? Math.round(numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length)
    : 0;

  return {
    seo: categoryScores.seo,
    aeo: categoryScores.aeo,
    geo: categoryScores.geo,
    total: totalScore,
    applicableWeights
  };
}

function extractJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return null;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value, maxItems = 3) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseExecutiveSummaryResponse(text) {
  const parsed = extractJsonPayload(text);
  if (!parsed) {
    return { rawText: String(text || '').trim() };
  }

  return {
    statusLine: normalizeString(parsed.statusLine),
    causes: normalizeStringList(parsed.causes, 3),
    differenceInterpretation: normalizeString(parsed.differenceInterpretation),
    rawText: String(text || '').trim()
  };
}

function parsePriorityActionsResponse(text) {
  const parsed = extractJsonPayload(text);
  if (!parsed || !Array.isArray(parsed.actions)) {
    return { rawText: String(text || '').trim(), actions: [] };
  }

  return {
    actions: parsed.actions
      .map((action) => ({
        title: normalizeString(action?.title),
        reason: normalizeString(action?.reason),
        tasks: normalizeStringList(action?.tasks, 3),
        whyNow: normalizeString(action?.whyNow)
      }))
      .filter((action) => action.title)
      .slice(0, 3),
    rawText: String(text || '').trim()
  };
}

function parseExecutionPlanResponse(text) {
  const parsed = extractJsonPayload(text);
  if (!parsed) {
    return { rawText: String(text || '').trim() };
  }

  return {
    today: normalizeStringList(parsed.today, 2),
    thisWeek: normalizeStringList(parsed.thisWeek, 2),
    later: normalizeStringList(parsed.later, 2),
    rawText: String(text || '').trim()
  };
}

function buildExecutionPlanSeed(assessment) {
  const failedIds = new Set(assessment.priorityFailures.map((item) => item.id));
  const today = [];
  const thisWeek = [];
  const later = [];
  const pageType = assessment.pageProfile?.type || 'generic';

  const hasAny = (ids) => ids.some((id) => failedIds.has(id));
  const addUnique = (target, text) => {
    if (text && !target.includes(text) && target.length < 2) {
      target.push(text);
    }
  };

  const hasMetaSet = hasAny(['og_title', 'og_description', 'og_image', 'twitter_card']);
  const hasStructuredTrustSet = hasAny(['structured_data', 'author_info', 'publish_date']);
  const hasTrustContextSet = hasAny(['source_attribution', 'breadcrumb_schema', 'faq_schema']);

  if (hasMetaSet) {
    addUnique(today, 'OG/Twitter 메타 태그를 서버 HTML <head> 기준으로 한 번에 정리합니다.');
  }

  if (hasStructuredTrustSet) {
    const structuredCopy = pageType === 'article'
      ? 'Article JSON-LD에 저자·발행일을 함께 묶어 반영합니다.'
      : '페이지 유형에 맞는 JSON-LD 구조화 데이터를 기본 필드와 함께 반영합니다.';
    addUnique(hasMetaSet ? thisWeek : today, structuredCopy);
  }

  if (pageType === 'article' && failedIds.has('source_attribution')) {
    addUnique(thisWeek, '이미지·인용구 출처 표기 기준을 정리하고 본문 템플릿에 반영합니다.');
  }

  if (failedIds.has('faq_schema')) {
    addUnique(later, 'FAQ가 실제로 필요한 페이지에만 FAQ Schema를 선택적으로 추가합니다.');
  }

  if (failedIds.has('breadcrumb_schema')) {
    addUnique(later, 'Breadcrumb Schema를 템플릿 단위로 추가해 탐색 구조를 명확히 합니다.');
  }

  if (today.length === 0) {
    addUnique(today, '핵심 메타와 제목 체계를 먼저 정리해 기본 노출 신호를 안정화합니다.');
  }

  if (thisWeek.length === 0 && hasAny(['title_tag', 'meta_description', 'h1_tag', 'headings_structure', 'clear_summary'])) {
    addUnique(thisWeek, '본문 첫 요약과 제목 구조를 다듬어 검색·AI 해석 품질을 보강합니다.');
  }

  if (later.length === 0) {
    addUnique(later, '배포 후 봇 HTML과 실제 브라우저 결과를 다시 비교해 남은 차이를 점검합니다.');
  }

  return { today, thisWeek, later };
}

/**
 * 현황 해석 생성
 *
 * @param {AuditResult|object} auditInput - 검사 결과 또는 dual audit 결과
 * @returns {Promise<object>} 구조화된 현황 해석
 */
export async function getExecutiveSummary(auditInput) {
  const config = await getGeoAuditConfig();
  if (!config.hasApiKey) throw new Error('페이지 진단 AI 해석에는 OpenRouter API Key가 필요합니다.');

  const assessment = buildAuditAssessment(auditInput);
  const primaryScores = assessment.primaryResult?.scores || {};
  const weakCategoryText = assessment.weakCategories.length
    ? assessment.weakCategories.map((item) => `${item.label} ${item.score}점`).join(', ')
    : '없음';
  const priorityFailureText = assessment.priorityFailures
    .slice(0, 5)
    .map((item) => `- ${item.title} (${item.category.toUpperCase()}, ${item.weight}pt): ${item.hint}`)
    .join('\n') || '- 없음';
  const passedSignalText = assessment.passedSignals.length
    ? assessment.passedSignals.map((title) => `- ${title}`).join('\n')
    : '- 없음';

  const prompt = `당신은 냉정하지만 실무적인 웹사이트 진단 컨설턴트입니다.

## 진단 기준
- 총점이 60점 미만이면 부족한 상태로 판단합니다.
- 카테고리 점수가 45점 미만이면 그 영역은 핵심 보완이 필요합니다.
- 점수가 낮으면 칭찬으로 시작하지 마세요.
- 근거 없는 낙관 표현과 과장된 기대효과는 쓰지 마세요.
- 차이점이 작으면 CSR 위험을 과장하지 마세요.

## 현재 점검 결과
- 페이지 유형: ${assessment.pageProfile?.label || '일반 페이지'}
- 상태 등급: ${assessment.severityLabel}
- 봇 총점: ${primaryScores.total}/100
- 봇 세부 점수: SEO ${formatScoreForPrompt(primaryScores.seo)}, AEO ${formatScoreForPrompt(primaryScores.aeo)}, GEO ${formatScoreForPrompt(primaryScores.geo)}
- 브라우저 총점: ${assessment.secondaryResult?.scores?.total ?? primaryScores.total}/100
- 점수 제외 항목: ${assessment.skippedCount}개
- 봇/브라우저 차이 항목: ${assessment.diffCount}개
- 점수 차이: ${assessment.scoreGap}점
- 약한 영역: ${weakCategoryText}

## 이미 확보된 기본요소
${passedSignalText}

## 핵심 실패 항목
${priorityFailureText}

## 응답 형식
아래 JSON 객체만 반환하세요. 마크다운, 설명, 코드블록을 붙이지 마세요.
{
  "statusLine": "현재 상태를 한 줄로 요약",
  "causes": ["핵심 원인 1", "핵심 원인 2"],
  "differenceInterpretation": "봇/브라우저 차이에 대한 해석 한 문장"
}`;

  return parseExecutiveSummaryResponse(await fetchLLM(prompt, config));
}

/**
 * 우선순위 액션 분석
 *
 * @param {AuditResult|object} auditInput - 검사 결과 또는 dual audit 결과
 * @returns {Promise<object>} 구조화된 우선순위 액션
 */
export async function getPriorityActions(auditInput) {
  const config = await getGeoAuditConfig();
  if (!config.hasApiKey) throw new Error('페이지 진단 AI 해석에는 OpenRouter API Key가 필요합니다.');

  const assessment = buildAuditAssessment(auditInput);
  const primaryScores = assessment.primaryResult?.scores || {};
  const failedItems = assessment.priorityFailures
    .slice(0, 8)
    .map((item) => `- ${item.title} (${item.category.toUpperCase()}, ${item.weight}pt): ${item.hint}`)
    .join('\n') || '- 없음';

  const prompt = `당신은 실용적인 웹사이트 컨설턴트입니다. 다음은 페이지 진단 결과입니다.

## 기준 점수
- 페이지 유형: ${assessment.pageProfile?.label || '일반 페이지'}
- 봇 총점: ${primaryScores.total}/100
- SEO ${formatScoreForPrompt(primaryScores.seo)}, AEO ${formatScoreForPrompt(primaryScores.aeo)}, GEO ${formatScoreForPrompt(primaryScores.geo)}
- 상태 등급: ${assessment.severityLabel}

## 우선 검토할 실패 항목
${failedItems}

## 규칙
- 정확히 3개
- 비슷한 항목은 하나로 묶으세요 (예: OG 제목/설명/이미지는 하나의 액션으로 통합 가능)
- 코드 예시, 장황한 설명, 정량 수치 예측은 넣지 마세요
- 각 액션은 짧고 바로 실행 가능해야 합니다

## 응답 형식
아래 JSON 객체만 반환하세요. 마크다운, 설명, 코드블록을 붙이지 마세요.
{
  "actions": [
    {
      "title": "액션 제목",
      "reason": "왜 중요한지 한 문장",
      "tasks": ["지금 할 일 1", "지금 할 일 2"],
      "whyNow": "왜 먼저 해야 하는지 한 문장"
    },
    {
      "title": "액션 제목",
      "reason": "왜 중요한지 한 문장",
      "tasks": ["지금 할 일 1", "지금 할 일 2"],
      "whyNow": "왜 먼저 해야 하는지 한 문장"
    },
    {
      "title": "액션 제목",
      "reason": "왜 중요한지 한 문장",
      "tasks": ["지금 할 일 1", "지금 할 일 2"],
      "whyNow": "왜 먼저 해야 하는지 한 문장"
    }
  ]
}`;

  return parsePriorityActionsResponse(await fetchLLM(prompt, config));
}

/**
 * 실행 로드맵 생성
 *
 * @param {AuditResult|object} auditInput - 검사 결과 또는 dual audit 결과
 * @returns {Promise<object>} 구조화된 실행 계획
 */
export async function getExecutionPlan(auditInput) {
  const assessment = buildAuditAssessment(auditInput);
  return buildExecutionPlanSeed(assessment);
}

/**
 * 일반 LLM 요청
 *
 * @param {string} prompt - 프롬프트
 * @param {object} config - 활성 프로바이더 구성
 * @returns {Promise<string>} 전체 응답 텍스트
 */
async function fetchLLM(prompt, config) {
  return await runPrompt({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    prompt,
    purpose: 'geo-audit'
  });
}

async function getClientAuditResult(targetTabId, expectedUrl, parser) {
  try {
    const response = await chrome.tabs.sendMessage(targetTabId, {
      action: ACTIONS.RUN_CLIENT_GEO_AUDIT,
      expectedUrl
    });

    if (response?.success && response.auditResult) {
      return response.auditResult;
    }

    if (response?.error === '검사 중 페이지가 변경되었습니다. 다시 시도해주세요.') {
      throw new Error(response.error);
    }
  } catch (error) {
    if (String(error?.message || '').includes('검사 중 페이지가 변경되었습니다')) {
      throw error;
    }
  }

  const fallbackResponse = await chrome.tabs.sendMessage(targetTabId, {
    action: ACTIONS.GET_CURRENT_HTML
  });

  if (!fallbackResponse || fallbackResponse.error) {
    throw new Error(fallbackResponse?.error || '브라우저 HTML 가져오기 실패');
  }

  if (expectedUrl && fallbackResponse.url && fallbackResponse.url !== expectedUrl) {
    throw new Error('검사 중 페이지가 변경되었습니다. 다시 시도해주세요.');
  }

  const clientDoc = parser.parseFromString(fallbackResponse.html, 'text/html');
  return await runAudit(clientDoc, {
    url: fallbackResponse.url || expectedUrl,
    source: 'client'
  });
}

/**
 * 봇 vs 브라우저 Dual Audit 실행
 *
 * 동작:
 * 1. background.js를 통해 초기 HTML fetch (봇 시뮬레이션)
 * 2. DOMParser로 파싱하여 botDoc 생성
 * 3. runAudit(botDoc) - 봇이 보는 검사
 * 4. runAudit(document) - 브라우저가 보는 검사
 * 5. 두 결과 비교 및 반환
 *
 * @param {string} url - 검사할 페이지 URL (http/https만)
 * @returns {Promise<{botResult: AuditResult, clientResult: AuditResult, differences: Array}>}
 *
 * @example
 * // geo-tab.js에서 호출:
 * const dualResult = await runDualAudit('https://example.com');
 * console.log('봇 점수:', dualResult.botResult.scores.total);
 * console.log('브라우저 점수:', dualResult.clientResult.scores.total);
 * console.log('차이점:', dualResult.differences.length);
 */
export async function runDualAudit(url, options = {}) {
  const targetTabId = Number(options.tabId);
  const expectedUrl = String(options.expectedUrl || url || '').trim();

  // 1. URL 검증
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw new Error('http/https URL만 지원합니다');
  }

  if (!Number.isInteger(targetTabId)) {
    throw new Error('검사 탭 정보를 찾을 수 없습니다');
  }

  // 2. background.js를 통해 HTML fetch
  const response = await chrome.runtime.sendMessage({
    action: ACTIONS.FETCH_HTML_FOR_BOT_AUDIT,
    url
  });

  if (!response.success) {
    throw new Error(response.error || 'HTML 가져오기 실패');
  }

  // 3. DOMParser로 파싱 (봇이 보는 HTML)
  const parser = new DOMParser();
  const botDoc = parser.parseFromString(response.html, 'text/html');

  // 4. 봇 검사 (서버 HTML)
  const botResult = await runAudit(botDoc, { url, source: 'bot' });

  // 5. 브라우저 검사
  // 최신 content script면 현재 탭에서 바로 audit 결과만 계산하고,
  // 구버전 탭은 HTML 스냅샷 fallback으로 호환한다.
  const clientResult = await getClientAuditResult(targetTabId, expectedUrl, parser);

  // 5. 차이점 계산
  const differences = [];
  const clientResultById = new Map(clientResult.results.map((result) => [result.id, result]));
  botResult.results.forEach((botItem) => {
    const clientItem = clientResultById.get(botItem.id);
    const bothApplicable = botItem?.applicable !== false && clientItem?.applicable !== false;
    if (bothApplicable && botItem.passed !== clientItem.passed) {
      differences.push({
        id: botItem.id,
        title: botItem.title,
        category: botItem.category,
        botPassed: botItem.passed,
        clientPassed: clientItem.passed
      });
    }
  });

  return {
    botResult,
    clientResult,
    differences,
    tabId: targetTabId,
    url,
    timestamp: new Date().toISOString()
  };
}

/**
 * 검사 결과를 로깅 (디버그용)
 *
 * @param {AuditResult} auditResult - 검사 결과
 */
export function logAuditResult(auditResult) {
  console.group('🔍 GEO 검사 결과');
  console.log(`페이지 유형: ${auditResult.pageProfile?.label || '일반 페이지'}`);
  console.log(`총점: ${auditResult.scores.total}/100`);
  console.log(`SEO: ${formatScoreLabel(auditResult.scores.seo)}, AEO: ${formatScoreLabel(auditResult.scores.aeo)}, GEO: ${formatScoreLabel(auditResult.scores.geo)}`);
  console.log(`통과: ${auditResult.passedCount}/${auditResult.applicableCount}`);
  console.log(`제외: ${auditResult.skippedCount}개`);

  console.group('실패 항목');
  auditResult.results
    .filter(r => r.applicable !== false && !r.passed)
    .forEach(r => {
      console.log(`❌ ${r.title} (${r.category.toUpperCase()}): ${r.hint}`);
    });
  console.groupEnd();

  console.log('전체 결과:', auditResult.results);
  console.groupEnd();
}
