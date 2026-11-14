import { describe, expect, it } from 'vitest'
import { createAntigravityCliUsageClient } from '../../../../collector/infra/usage/antigravity-cli-usage-client.mjs'

const TSV = [
  'Gemini Models\tWeekly Limit Remaining\t12%\t2026-11-14T04:46:03Z',
  'claude and gpt models\tFive Hour Limit Remaining\t100%\t2026-11-14T07:25:12Z',
].join('\n')

describe('Given the Antigravity CLI usage client', () => {
  it('When the CLI returns rows Then the envelope body is the CLI raw JSON', async () => {
    const client = createAntigravityCliUsageClient({ runQuota: async () => TSV })
    const result = await client.fetchUsage()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.httpStatus).toBeNull()
    const parsed = JSON.parse(result.bodyText)
    expect(parsed.source).toBe('agy-quota-cli')
    expect(parsed.rows).toEqual([
      { group: 'Gemini Models', label: 'Weekly Limit Remaining', remainingPercent: 12, resetsAt: '2026-11-14T04:46:03Z' },
      { group: 'claude and gpt models', label: 'Five Hour Limit Remaining', remainingPercent: 100, resetsAt: '2026-11-14T07:25:12Z' },
    ])
  })
  it('When the CLI fails or times out Then it is an upstream error with no body', async () => {
    const client = createAntigravityCliUsageClient({ runQuota: async () => null })
    expect(await client.fetchUsage()).toEqual({ ok: false, kind: 'upstream_error', httpStatus: null, retryAfterSec: null, diag: 'cli_failed' })
  })
  it('When the CLI output has no valid rows Then it is an upstream error', async () => {
    const client = createAntigravityCliUsageClient({ runQuota: async () => 'not a quota table' })
    expect(await client.fetchUsage()).toMatchObject({ ok: false, kind: 'upstream_error', diag: 'empty_quota' })
  })
})
