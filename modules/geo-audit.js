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

import { GEO_CHECKLIST, groupChecklistByCategory, calculateTotalWeights } from './geo-checklist.js';
import { getActiveTranslationConfig } from './storage.js';
import { runPrompt } from './provider-client.js';

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
export async function runAudit(doc = document) {
  const results = [];
  let passedCount = 0;
  let failedCount = 0;

  // 체크리스트 순회 (자동, if 없음)
  for (const checkItem of GEO_CHECKLIST) {
    try {
      // 1. selector 실행 → DOM 요소 또는 데이터 추출
      const selected = checkItem.selector(doc);

      // 2. validator 실행 → pass/fail 결정
      const passed = checkItem.validator(selected);

      // 3. 결과 기록
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc) : checkItem.hint;

      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed,
        hint
      });

      // 통계
      if (passed) passedCount++;
      else failedCount++;
    } catch (error) {
      // selector/validator 에러는 fail 처리
      // hint가 함수이면 실행, 문자열이면 그대로 사용
      const hint = typeof checkItem.hint === 'function' ? checkItem.hint(doc) : checkItem.hint;

      results.push({
        id: checkItem.id,
        title: checkItem.title,
        category: checkItem.category,
        weight: checkItem.weight,
        passed: false,
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
    failedItems: results.filter(r => !r.passed).map(r => r.id),
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
  const weights = calculateTotalWeights();
  const grouped = groupChecklistByCategory();

  // 카테고리별 획득 점수 계산
  const categoryScores = {};
  Object.keys(grouped).forEach(category => {
    const categoryItems = results.filter(r => r.category === category);
    const earnedWeight = categoryItems
      .filter(r => r.passed)
      .reduce((sum, r) => sum + r.weight, 0);
    const totalWeight = weights[category];
    categoryScores[category] = Math.round((earnedWeight / totalWeight) * 100);
  });

  // 총점 = 모든 카테고리 평균
  const categories = Object.keys(categoryScores);
  const totalScore = Math.round(
    categories.reduce((sum, cat) => sum + categoryScores[cat], 0) / categories.length
  );

  return {
    seo: categoryScores.seo || 0,
    aeo: categoryScores.aeo || 0,
    geo: categoryScores.geo || 0,
    total: totalScore
  };
}

/**
 * 강점 분석 (통과한 항목 칭찬)
 *
 * @param {AuditResult} auditResult - 검사 결과
 * @returns {Promise<string>} 전체 텍스트
 */
export async function getStrengths(auditResult) {
  const config = await getActiveTranslationConfig();
  if (!config.hasApiKey) throw new Error('API Key가 설정되지 않았습니다');

  const passedItems = auditResult.results
    .filter(r => r.passed)
    .map(r => `- ${r.title}`)
    .join('\n');

  const prompt = `당신은 친절한 웹사이트 컨설턴트입니다. 다음은 GEO 검사에서 통과한 항목들입니다.

## 통과한 항목
${passedItems}

## 요청
위 항목들을 보고 **2-3문장으로 긍정적으로 칭찬**해주세요.

예시:
"현재 페이지 제목과 메타 설명이 이미 잘 최적화되어 있네요! 👍 특히 Open Graph 태그가 완벽하게 설정되어 있어 소셜 미디어 공유 시 멋지게 보일 거예요."

## 규칙
- 마크다운 형식
- 2-3문장
- 긍정적이고 격려하는 톤
- 한국어`;

  return await fetchLLM(prompt, config);
}

/**
 * 개선사항 분석 (실패 항목 TOP 3)
 *
 * @param {AuditResult} auditResult - 검사 결과
 * @returns {Promise<string>} 전체 텍스트
 */
export async function getImprovements(auditResult) {
  const config = await getActiveTranslationConfig();
  if (!config.hasApiKey) throw new Error('API Key가 설정되지 않았습니다');

  const failedItems = auditResult.results
    .filter(r => !r.passed)
    .map(r => `- ${r.title}: ${r.hint}`)
    .join('\n');

  const prompt = `당신은 실용적인 웹사이트 컨설턴트입니다. 다음은 GEO 검사에서 실패한 항목들입니다.

## 점수
총점: ${auditResult.scores.total}/100 (SEO: ${auditResult.scores.seo}, AEO: ${auditResult.scores.aeo}, GEO: ${auditResult.scores.geo})

## 개선 필요 항목
${failedItems}

## 요청
위 항목 중 **가장 중요한 3가지**를 선택하여 **마크다운 형식**으로 구체적인 개선 방법을 알려주세요.

### 각 항목마다 포함할 내용
1. **제목** (명확하고 간결하게)
2. **왜 중요한가?** (비즈니스 임팩트, 1-2문장)
3. **어떻게 개선할까?** (구체적인 실행 방법, 3-4개 단계)
4. **코드 예시** (가능하면 HTML/JSON-LD 예시)
5. **기대 효과** (정량적 수치 포함, 2-3개)
6. **난이도와 시간** (쉬움/보통/어려움, 예상 소요 시간)

### 예시 형식
## 1. 메타 설명 최적화

**왜 중요한가?**
메타 설명은 검색 결과에 표시되는 미리보기 텍스트로, CTR(클릭률)에 직접적인 영향을 미칩니다.

**어떻게 개선할까?**
- 150-160자 범위로 작성
- 주요 키워드를 자연스럽게 포함
- 행동 유도 문구 추가 (예: "지금 확인해보세요")
- 페이지 내용을 정확히 요약

**코드 예시**
\`\`\`html
<meta name="description" content="BBC News는 전 세계 뉴스, 정치, 비즈니스, 과학 정보를 제공합니다. 최신 뉴스 기사와 분석을 지금 읽어보세요.">
\`\`\`

**기대 효과**
- CTR 15-20% 증가
- 검색 결과에서 설명이 온전히 표시됨
- 사용자가 페이지 내용을 미리 파악

**난이도와 시간**
⚡ 쉬움 | 30분

---

## 규칙
- 마크다운 형식 엄수
- 정확히 3개 항목
- 한국어로 작성
- 실행 가능한 구체적인 방법
- 코드 예시는 HTML 엔터티 없이 일반 코드블록 사용`;

  return await fetchLLM(prompt, config);
}

/**
 * 실행 로드맵 생성
 *
 * @param {AuditResult} auditResult - 검사 결과
 * @returns {Promise<string>} 전체 텍스트
 */
export async function getRoadmap(auditResult) {
  const config = await getActiveTranslationConfig();
  if (!config.hasApiKey) throw new Error('API Key가 설정되지 않았습니다');

  const failedCount = auditResult.failedCount;

  const prompt = `당신은 격려하는 코치입니다. GEO 검사에서 ${failedCount}개 항목이 실패했습니다.

## 요청
개선 작업을 위한 **실행 로드맵**과 **격려 메시지**를 작성해주세요.

### 형식
## 📅 실행 로드맵

**오늘 (30분-1시간)**
- 메타 설명 최적화
- Alt 텍스트 추가

**이번 주 (2-3시간)**
- JSON-LD 구조화 데이터 추가
- FAQ 스키마 구축

**장기 (지속적)**
- 콘텐츠 신뢰도 향상 (저자 정보, 출처 명시)
- 정기적인 검사 및 업데이트

---

## 💬 마무리
이미 ${auditResult.passedCount}개 항목을 잘 준수하고 계십니다! 위 개선사항만 적용하면 검색 가시성이 크게 향상될 거예요. 🚀

## 규칙
- 마크다운 형식
- 3-4문장
- 격려하는 톤
- 한국어`;

  return await fetchLLM(prompt, config);
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
export async function runDualAudit(url) {
  // 1. URL 검증
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw new Error('http/https URL만 지원합니다');
  }

  // 2. background.js를 통해 HTML fetch
  const response = await chrome.runtime.sendMessage({
    action: 'FETCH_HTML_FOR_BOT_AUDIT',
    url
  });

  if (!response.success) {
    throw new Error(response.error || 'HTML 가져오기 실패');
  }

  // 3. DOMParser로 파싱 (봇이 보는 HTML)
  const parser = new DOMParser();
  const botDoc = parser.parseFromString(response.html, 'text/html');

  // 4. 봇 검사 (서버 HTML)
  const botResult = await runAudit(botDoc);

  // 5. 브라우저 검사 (현재 탭의 document에서 실행)
  // Content Script에서 현재 HTML을 받아서 파싱
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;

  if (!tabId) {
    throw new Error('활성 탭을 찾을 수 없습니다');
  }

  // Content Script에서 현재 HTML 가져오기
  const clientResponse = await chrome.tabs.sendMessage(tabId, {
    action: 'GET_CURRENT_HTML'
  });

  if (!clientResponse || clientResponse.error) {
    throw new Error(clientResponse?.error || '브라우저 HTML 가져오기 실패');
  }

  // DOMParser로 파싱 (JavaScript 실행된 후의 HTML)
  const clientDoc = parser.parseFromString(clientResponse.html, 'text/html');
  const clientResult = await runAudit(clientDoc);

  // 5. 차이점 계산
  const differences = [];
  botResult.results.forEach((botItem, idx) => {
    const clientItem = clientResult.results[idx];
    if (botItem.passed !== clientItem.passed) {
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
  console.log(`총점: ${auditResult.scores.total}/100`);
  console.log(`SEO: ${auditResult.scores.seo}/100, AEO: ${auditResult.scores.aeo}/100, GEO: ${auditResult.scores.geo}/100`);
  console.log(`통과: ${auditResult.passedCount}/${auditResult.results.length}`);

  console.group('실패 항목');
  auditResult.results
    .filter(r => !r.passed)
    .forEach(r => {
      console.log(`❌ ${r.title} (${r.category.toUpperCase()}): ${r.hint}`);
    });
  console.groupEnd();

  console.log('전체 결과:', auditResult.results);
  console.groupEnd();
}
