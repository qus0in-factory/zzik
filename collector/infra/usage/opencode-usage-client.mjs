import { fetchUsageJson } from './fetch-usage-json.mjs'

/** @typedef {import('../../domain/usage/ports.mjs').UsageCallResult} UsageCallResult */

export const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/**
 * @param {{ fetchImpl: typeof fetch, nowMs?: () => number, timeoutMs?: number }} deps
 * @returns {{ fetchUsage(token: string): Promise<UsageCallResult> }}
 */
export function createOpencodeUsageClient({ fetchImpl, nowMs = Date.now, timeoutMs = 10_000 }) {
  return {
    fetchUsage: (token) =>
      fetchUsageJson({
        fetchImpl,
        url: OPENCODE_USAGE_URL,
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        timeoutMs,
        nowMs,
      }),
  }
}
