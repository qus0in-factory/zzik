/**
 * Anthropic usage HTTP 클라이언트(ADR 0.2 D8 전 단계, biseo 조사 문서 §3 기준).
 * 헤더 3개(Bearer + OAuth beta + Accept), 타임아웃 10초(D2), 상태코드를 결과 종류로 변환한다.
 * 토큰은 헤더로만 흐르고 결과 어디에도 실리지 않는다.
 */

import { parseRetryAfter } from '../../domain/usage/retry-after.mjs'

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult
 */

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   nowMs?: () => number,
 *   timeoutMs?: number,
 * }} deps
 * @returns {{ fetchUsage(token: string): Promise<UsageCallResult> }}
 */
export function createUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('usage client needs a fetchImpl')
  return {
    async fetchUsage(token) {
      try {
        const headers = {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          Accept: 'application/json',
        }
        const res = await fetchImpl(USAGE_URL, { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) })
        if (res.status === 200) {
          return { ok: true, bodyText: await res.text(), httpStatus: 200, retryAfterSec: null }
        }
        const retryAfterSec = parseRetryAfter(res.headers?.get?.('retry-after') ?? null, nowMs())
        const kind = res.status === 429 ? 'rate_limited' : res.status === 401 || res.status === 403 ? 'auth_required' : 'upstream_error'
        return { ok: false, kind, httpStatus: res.status, retryAfterSec }
      } catch {
        return { ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null }
      }
    },
  }
}
