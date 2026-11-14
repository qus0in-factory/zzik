/** Antigravity 수집(ADR 0.4 0.6 변경): API 대신 `agy -p /quota` 출력만 쓴다. */
import { buildQuotaRawText } from '../../domain/usage/agy-quota-cli.mjs'
import { runAgyQuotaCli } from './agy-quota-cli-runner.mjs'

/**
 * @param {{ runQuota?: () => Promise<string|null> }} [deps]
 * @returns {{ fetchUsage(token?: string, options?: { accountId?: string|null }): Promise<import('../../domain/usage/ports.mjs').UsageCallResult> }}
 */
export function createAntigravityCliUsageClient({ runQuota = () => runAgyQuotaCli() } = {}) {
  return {
    async fetchUsage() {
      const text = await runQuota()
      const bodyText = typeof text === 'string' ? buildQuotaRawText(text) : null
      if (bodyText === null) {
        return { ok: false, kind: 'upstream_error', httpStatus: null, retryAfterSec: null, diag: typeof text === 'string' ? 'empty_quota' : 'cli_failed' }
      }
      return { ok: true, bodyText, httpStatus: null, retryAfterSec: null }
    },
  }
}
