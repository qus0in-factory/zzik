import { fetchUsageJson } from './fetch-usage-json.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

/** 로컬 데몬 조회가 다른 호스트로 새지 않도록 loopback http만 허용한다. */
const LOOPBACK_HOST = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/

/** @param {unknown} host @returns {boolean} */
export function isAllowedOllamaHost(host) {
  return typeof host === 'string' && LOOPBACK_HOST.test(host)
}

/**
 * 로컬 데몬의 /api/balance를 읽는다. 토큰이 없으므로 Authorization 헤더를 보내지 않는다.
 * @param {{ fetchImpl: typeof fetch, host?: string, nowMs?: () => number, timeoutMs?: number }} deps
 * @returns {{ fetchUsage(token?: string): Promise<UsageCallResult> }}
 */
export function createOllamaUsageClient({ fetchImpl, host = DEFAULT_OLLAMA_HOST, nowMs = Date.now, timeoutMs = 3_000 }) {
  if (!isAllowedOllamaHost(host)) throw new TypeError('Invalid Ollama host')
  return {
    fetchUsage: () => fetchUsageJson({ fetchImpl, url: host + '/api/balance', headers: { Accept: 'application/json' }, timeoutMs, nowMs }),
  }
}
