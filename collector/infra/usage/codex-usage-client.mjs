/**
 * WHAM 클라이언트(ADR 0.3 D1·D4 v2). GET https://chatgpt.com/backend-api/wham/usage,
 * 헤더는 Authorization + Accept(계정 헤더는 옵셥), redirect: 'manual'(3xx는 진단만),
 * 타임아웃 10초. 응답 분류는 D4의 표 그대로고, 실패 결과에는 로그용 diag만 실린다
 * (본문·헤더 전문·토큰·계정 값은 담지 않는다).
 */

import { parseRetryAfter } from '../../domain/usage/retry-after.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

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

/** @param {Response} res @returns {string} */
function contentTypeOf(res) {
  return res.headers?.get?.('content-type') ?? 'none'
}

/** 진단용 본문 지문 앞 8자(sha256, 값은 담지 않는다). */
/** @param {string} text @returns {Promise<string>} */
async function sha8(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].slice(0, 4).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {{
 *   fetchImpl: typeof fetch,
 *   nowMs?: () => number,
 *   timeoutMs?: number,
 * }} deps
 * @returns {{ fetchUsage(token: string, options?: { accountId?: string|null }): Promise<UsageCallResult> }}
 */
export function createCodexUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('codex usage client needs a fetchImpl')
  return {
    async fetchUsage(token, options = {}) {
      try {
        /** @type {Record<string, string>} */
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        }
        // 계정 헤더는 옵션이 켜졌을 때만 보낸다(D4). 값은 auth.json에서 읽어 헤더로만 흐른다.
        const accountId = options.accountId ?? null
        if (accountId !== null) headers['ChatGPT-Account-Id'] = accountId
        const res = await fetchImpl(WHAM_USAGE_URL, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
        const status = res.status

        if (status >= 300 && status < 400) {
          // 리다이렉트는 진단에 호스트만 남긴다(경로·쿼리는 남기지 않는다, D4).
          let locationHost = ''
          try {
            locationHost = new URL(res.headers?.get?.('location') ?? '').host
          } catch {
            locationHost = ''
          }
          return {
            ok: false,
            kind: 'upstream_error',
            httpStatus: status,
            retryAfterSec: null,
            diag: locationHost === '' ? 'redirect' : `redirect:${locationHost}`,
          }
        }
        const text = await res.text()

        if (status === 200) {
          if (isJsonObjectText(text)) return { ok: true, bodyText: text, httpStatus: 200, retryAfterSec: null }
          // 200이지만 JSON이 아니면(HTML 등) 본문을 저장하지 않고 진단만 남긴다(D4).
          return { ok: false, kind: 'upstream_error', httpStatus: 200, retryAfterSec: null, diag: `non-json content-type=${contentTypeOf(res)}` }
        }
        if (status === 401) return { ok: false, kind: 'auth_required', httpStatus: 401, retryAfterSec: null }
        if (status === 403) {
          // 403이 JSON이면 재로그인으로 풀리는 인증 거부다. 아니면 앞단 차단 페이지로
          // 취급해 다음 행동(하루 뒤 재시도)이 달라진다(D4). 진단은 차단 판별에 쓴다.
          if (isJsonObjectText(text)) return { ok: false, kind: 'auth_required', httpStatus: 403, retryAfterSec: null }
          return {
            ok: false,
            kind: 'upstream_error',
            httpStatus: 403,
            retryAfterSec: null,
            diag: `blocked content-type=${contentTypeOf(res)} cf-mitigated=${res.headers?.get?.('cf-mitigated') ?? 'none'} cf-ray=${(res.headers?.get?.('cf-ray') ?? 'none').slice(0, 8)} sha8=${await sha8(text)}`,
          }
        }
        if (status === 429) {
          return { ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: parseRetryAfter(res.headers?.get?.('retry-after') ?? null, nowMs()) }
        }
        return { ok: false, kind: 'upstream_error', httpStatus: status, retryAfterSec: null }
      } catch (error) {
        // 타임아웃은 upstream_error, 연결 실패는 network_error다(D4의 표).
        const name = error !== null && typeof error === 'object' ? /** @type {{ name?: string }} */ (error).name : undefined
        if (name === 'TimeoutError' || name === 'AbortError') {
          return { ok: false, kind: 'upstream_error', httpStatus: null, retryAfterSec: null, diag: 'timeout' }
        }
        return { ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null }
      }
    },
  }
}
