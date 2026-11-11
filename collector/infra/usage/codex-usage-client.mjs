/**
 * WHAM 클라이언트(ADR 0.3 D1·D4). GET https://chatgpt.com/backend-api/wham/usage,
 * 헤더는 Authorization + Accept만, redirect: 'error'(토큰이 따라가지 않게), 타임아웃 10초.
 * 응답 분류는 D4의 표 그대로다. 토큰은 헤더로만 흐르고 결과에 실리지 않는다.
 */

import { parseRetryAfter } from '../../domain/usage/retry-after.mjs'

export const WHAM_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const DEFAULT_TIMEOUT_MS = 10_000

/** @param {string} text @returns {boolean} */
function isJsonObjectText(text) {
  try {
    const value = JSON.parse(text)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   nowMs?: () => number,
 *   timeoutMs?: number,
 * }} deps
 * @returns {{ fetchUsage(token: string): Promise<{ ok: true, bodyText: string, httpStatus: number, retryAfterSec: null } | { ok: false, kind: 'auth_required'|'rate_limited'|'upstream_error'|'network_error', httpStatus: number|null, retryAfterSec: number|null }>} }
 */
export function createCodexUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('codex usage client needs a fetchImpl')
  return {
    async fetchUsage(token) {
      try {
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        }
        const res = await fetchImpl(WHAM_USAGE_URL, {
          method: 'GET',
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
        const text = await res.text()

        if (res.status === 200) {
          if (isJsonObjectText(text)) return { ok: true, bodyText: text, httpStatus: 200, retryAfterSec: null }
          // 200이지만 JSON이 아니면(HTML 등) 본문을 저장하지 않는다(D4).
          return { ok: false, kind: 'upstream_error', httpStatus: 200, retryAfterSec: null }
        }
        if (res.status === 401) return { ok: false, kind: 'auth_required', httpStatus: 401, retryAfterSec: null }
        if (res.status === 403) {
          // 403이 JSON이면 재로그인으로 풀리는 인증 문제다. 아니면 앞단 차단 페이지다(D4).
          return isJsonObjectText(text)
            ? { ok: false, kind: 'auth_required', httpStatus: 403, retryAfterSec: null }
            : { ok: false, kind: 'upstream_error', httpStatus: 403, retryAfterSec: null }
        }
        if (res.status === 429) {
          return { ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: parseRetryAfter(res.headers?.get?.('retry-after') ?? null, nowMs()) }
        }
        return { ok: false, kind: 'upstream_error', httpStatus: res.status, retryAfterSec: null }
      } catch (error) {
        const name = error !== null && typeof error === 'object' ? /** @type {{ name?: string }} */ (error).name : undefined
        if (name === 'TimeoutError' || name === 'AbortError') {
          return { ok: false, kind: 'upstream_error', httpStatus: null, retryAfterSec: null }
        }
        return { ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null }
      }
    },
  }
}
