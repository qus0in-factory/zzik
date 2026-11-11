/**
 * 429·5xx 백오프 수열(ADR 0.2 D5).
 * - 429: 대기 = max(RA, min(600 × 2^n, 3600)). 상한 3600은 지수항에만 걸리고,
 *   서버가 더 긴 대기를 지시하면 그대로 따른다.
 * - 5xx·타임아웃: 대기 = min(600 × 2^n, 900).
 * n은 이번 실패 이전의 연속 실패 횟수(0부터)다.
 */

const BACKOFF_BASE_SEC = 600
const RATE_LIMIT_MAX_SEC = 3_600
const UPSTREAM_MAX_SEC = 900

/**
 * @param {'rate_limited'|'upstream_error'} kind
 * @param {number} failCount 이번 실패 이전의 연속 실패 횟수(429·5xx·타임아웃만 센다)
 * @param {number|null} retryAfterSec Retry-After 해석값, 없으면 null
 * @returns {number} 이번 실패로 게이트에 걸 대기(초)
 */
export function retryDelaySec(kind, failCount, retryAfterSec) {
  const withFailCount = failCount ?? 0
  if (kind === 'rate_limited') {
    const exponential = Math.min(BACKOFF_BASE_SEC * 2 ** withFailCount, RATE_LIMIT_MAX_SEC)
    if (retryAfterSec !== null && retryAfterSec !== undefined) {
      return Math.max(retryAfterSec, exponential)
    }
    return exponential
  }
  return Math.min(BACKOFF_BASE_SEC * 2 ** withFailCount, UPSTREAM_MAX_SEC)
}
