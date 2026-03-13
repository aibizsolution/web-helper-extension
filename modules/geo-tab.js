/**
 * GEO 검사 탭 초기화 및 이벤트 처리
 *
 * 책임:
 * - GEO 탭 UI 초기화
 * - "검사 시작" 버튼 이벤트 연결
 * - Content Script와 통신
 */

import { initGeoTab as initGeoUI } from './geo-ui.js';
import { logInfo, logError } from '../logger.js';
import * as State from './state.js';

function logGeoFlow(message, data = {}) {
  logInfo('sidepanel', 'GEO_AUDIT_FLOW', message, data);
}

/**
 * GEO 탭 초기화
 * - UI 요소 캐시 및 초기화
 * - "검사 시작" 버튼 이벤트 연결
 */
export function initGeoTab() {
  // UI 초기화 (geo-ui.js에서 이벤트 리스너 등록 처리)
  initGeoUI({
    onStartAudit: handleStartAudit,
    getLogger: logGeoFlow
  });

  logInfo('sidepanel', 'GEO_TAB_INIT', 'GEO 검사 탭 초기화 완료');
}

/**
 * 검사 시작 핸들러
 * - 검사 시작 로그만 기록 (실제 로직은 geo-ui.js의 handleRunAudit에서 처리)
 */
async function handleStartAudit() {
  try {
    const tabId = State.getCurrentTabId();
    if (!tabId) {
      logError('sidepanel', 'GEO_AUDIT_ERROR', '현재 탭 ID를 찾을 수 없습니다');
      return;
    }

    logInfo('sidepanel', 'GEO_AUDIT_START', '검사 시작', { tabId });
  } catch (error) {
    logError('sidepanel', 'GEO_AUDIT_ERROR', '검사 시작 실패', {}, error);
    throw error;
  }
}
