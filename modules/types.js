/**
 * 공용 타입 정의 (JSDoc typedef)
 */

/**
 * @typedef {Object} BatchInfo
 * @property {number} index
 * @property {number} size
 * @property {'pending'|'processing'|'completed'|'failed'} status
 */

/**
 * @typedef {Object} TranslationState
 * @property {'inactive'|'analyzing'|'translating'|'completed'|'restored'|'error'} state
 * @property {'idle'|'analyzing'|'visible'|'full'|'completed'} phase
 * @property {number} priority
 * @property {number} totalSegments
 * @property {number} visibleSegments
 * @property {number} translatedSegments
 * @property {number} totalTexts
 * @property {number} translatedCount
 * @property {number} cachedCount
 * @property {number} cacheHits
 * @property {number} batchCount
 * @property {number} batchesDone
 * @property {BatchInfo[]} batches
 * @property {number} activeRequests
 * @property {number} etaMs
 * @property {number} activeMs
 * @property {string} provider
 * @property {string} model
 * @property {'fast'|'precise'} profile
 * @property {string} originalTitle
 * @property {string} translatedTitle
 * @property {string} previewText
 */

/**
 * @typedef {Object} ProgressPayload
 * @property {TranslationState} data
 * @property {'progress'} type
 */

