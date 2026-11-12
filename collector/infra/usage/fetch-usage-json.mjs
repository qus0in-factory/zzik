import { parseRetryAfter } from '../../domain/usage/retry-after.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

/**
 * 사용량 GET 한 번과 응답 분류(ADR 0.3 D4 표). 본문은 성공(200 JSON 객체)일 때만 돌려주고,
 * 실패 본문은 어디에도 남기지 않는다. 제공자별 클라이언트가 URL·헤더·타임아웃만 정한다.
 * - 200 JSON 객체 → ok, 401/JSON 403 → auth_required, 429 → rate_limited(+Retry-After),
 *   3xx·그 밖 → upstream_error, 타임아웃 → upstream_error(timeout), 연결 실패 → network_error
 * @param {{ fetchImpl: typeof fetch, url: string, headers: Record<string, string>, timeoutMs: number, nowMs: () => number }} input
 * @returns {Promise<UsageCallResult>}
 */
export async function fetchUsageJson({ fetchImpl, url, headers, timeoutMs, nowMs }) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, kind: 'upstream_error', httpStatus: res.status, retryAfterSec: null, diag: 'redirect' }
    }
    const text = await res.text()
    /** @type {unknown} */
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      /* JSON이 아닌 본문은 보관하지 않는다 */
    }
    const isObject = body !== null && typeof body === 'object' && !Array.isArray(body)
    if (res.status === 200 && isObject) return { ok: true, bodyText: text, httpStatus: 200, retryAfterSec: null }
    const kind =
      res.status === 401 || (res.status === 403 && isObject) ? 'auth_required' : res.status === 429 ? 'rate_limited' : 'upstream_error'
    return {
      ok: false,
      kind,
      httpStatus: res.status,
      retryAfterSec: res.status === 429 ? parseRetryAfter(res.headers.get('retry-after'), nowMs()) : null,
    }
  } catch (error) {
    const name = error !== null && typeof error === 'object' ? /** @type {{ name?: string }} */ (error).name : undefined
    const timeout = name === 'TimeoutError' || name === 'AbortError'
    return { ok: false, kind: timeout ? 'upstream_error' : 'network_error', httpStatus: null, retryAfterSec: null, diag: timeout ? 'timeout' : undefined }
  }
}
