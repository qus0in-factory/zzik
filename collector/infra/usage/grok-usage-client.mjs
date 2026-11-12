import { fetchUsageJson } from './fetch-usage-json.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

export const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

/**
 * 공식 grok CLI로 자신을 알리는 클라이언트 식별 헤더. 이 프록시가 요구한다.
 * 사용자 승인 예외(ADR 0.3 D4 예외 #2, 2026-11-13, ADR 0.6). 값은 상수로 고정하고 env로 바꾸지 않는다.
 */
export const GROK_CLIENT_HEADERS = Object.freeze({
  'X-XAI-Token-Auth': 'xai-grok-cli',
  'x-grok-client-version': '1.0.0',
})

/**
 * @param {{ fetchImpl: typeof fetch, nowMs?: () => number, timeoutMs?: number }} deps
 * @returns {{ fetchUsage(token: string): Promise<UsageCallResult> }}
 */
export function createGrokUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = 10_000 }) {
  return {
    fetchUsage: (token) =>
      fetchUsageJson({
        fetchImpl,
        url: GROK_BILLING_URL,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...GROK_CLIENT_HEADERS },
        timeoutMs,
        nowMs,
      }),
  }
}
