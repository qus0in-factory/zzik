import { parseRetryAfter } from '../../domain/usage/retry-after.mjs'
import { argonBucketFromQuota, mergeArgonIntoSummary } from '../../domain/usage/agy-quota-cli.mjs'

/**
 * User-approved exception to ADR 0.3 D4 (ADR 0.4, 변경 사유 2026-11-13): the summary API filters the returned
 * groups by User-Agent, and only the antigravity/hub family includes the Gemini group.
 */
export const ANTIGRAVITY_USER_AGENT = 'antigravity/hub/2.9.1'
export const ANTIGRAVITY_API_HOSTS = ['cloudcode-pa.googleapis.com', 'daily-cloudcode-pa.googleapis.com']
/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

/** Only safe Google enum statuses are diagnostic data.
 * @param {unknown} body @returns {string|null}
 */
function errorStatus(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  const error = /** @type {Record<string, unknown>} */ (body)['error']
  const status = error !== null && typeof error === 'object'
    ? /** @type {Record<string, unknown>} */ (error)['status'] : null
  const safe = ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'INVALID_ARGUMENT', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'UNKNOWN', 'FAILED_PRECONDITION', 'ABORTED', 'CANCELLED', 'ALREADY_EXISTS', 'OUT_OF_RANGE', 'UNIMPLEMENTED', 'DATA_LOSS']
  return typeof status === 'string' && safe.includes(status) ? status : null
}

/** @param {{
 * fetchImpl: typeof fetch, host?: string,
 * nowMs?: () => number, timeoutMs?: number,
 * quotaCli?: () => Promise<string|null>
 * }} deps
 * @returns {{ fetchUsage(token: string, options?: {accountId?: string|null}): Promise<UsageCallResult> }}
 */
export function createAntigravityUsageClient({ fetchImpl, host = 'cloudcode-pa.googleapis.com', nowMs = Date.now, timeoutMs = 10_000, quotaCli }) {
  if (!ANTIGRAVITY_API_HOSTS.includes(host)) throw new TypeError('Invalid Antigravity API host')
  return {
    async fetchUsage(token) {
      try {
        const res = await fetchImpl('https://' + host + '/v1internal:retrieveUserQuotaSummary', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': ANTIGRAVITY_USER_AGENT },
          body: '{}',
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (res.status >= 300 && res.status < 400) {
          return { ok: false, kind: 'upstream_error', httpStatus: res.status, retryAfterSec: null, diag: 'redirect' }
        }
        const text = await res.text()
        /** @type {unknown} */
        let body = null
        try { body = JSON.parse(text) } catch { /* non-JSON must not be retained */ }
        const object = body !== null && typeof body === 'object' && !Array.isArray(body)
        if (res.status === 200 && object) return { ok: true, bodyText: await withArgon(text, quotaCli), httpStatus: 200, retryAfterSec: null }
        const kind = res.status === 401 || (res.status === 403 && object) ? 'auth_required'
          : res.status === 429 ? 'rate_limited' : 'upstream_error'
        return {
          ok: false, kind, httpStatus: res.status,
          retryAfterSec: res.status === 429 ? parseRetryAfter(res.headers.get('retry-after'), nowMs()) : null,
          diag: errorStatus(body) ?? undefined,
        }
      } catch (error) {
        const name = error !== null && typeof error === 'object' ? /** @type {{name?: string}} */ (error).name : undefined
        const timeout = name === 'TimeoutError' || name === 'AbortError'
        return { ok: false, kind: timeout ? 'upstream_error' : 'network_error', httpStatus: null, retryAfterSec: null, diag: timeout ? 'timeout' : undefined }
      }
    },
  }
}

/**
 * Argon 주간 버킷 합성(방안 B). CLI 실패·출력 없음·파싱 실패는 모두 원본 본문을 돌려준다
 * (Argon 카드만 생략되고 다른 카드에는 영향이 없다).
 * @param {string} bodyText @param {(() => Promise<string|null>)|undefined} quotaCli @returns {Promise<string>}
 */
async function withArgon(bodyText, quotaCli) {
  if (quotaCli === undefined) return bodyText
  try {
    const bucket = argonBucketFromQuota(await quotaCli())
    return bucket === null ? bodyText : mergeArgonIntoSummary(bodyText, bucket)
  } catch {
    return bodyText
  }
}
