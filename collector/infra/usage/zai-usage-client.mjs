import { fetchUsageJson } from './fetch-usage-json.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

export const ZAI_USAGE_URL = 'https://api.z.ai/api/monitor/usage/quota/limit'

/**
 * @param {{ fetchImpl: typeof fetch, nowMs?: () => number, timeoutMs?: number }} deps
 * @returns {{ fetchUsage(token: string): Promise<UsageCallResult> }}
 */
export function createZaiUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = 10_000 }) {
  return {
    fetchUsage: (token) =>
      fetchUsageJson({
        fetchImpl,
        url: ZAI_USAGE_URL,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        timeoutMs,
        nowMs,
      }),
  }
}
