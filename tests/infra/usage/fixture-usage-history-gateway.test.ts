import { describe, expect, it } from 'vitest'
import { createFixtureUsageHistoryGateway } from '@infra/usage/fixture-usage-history-gateway'

describe('Given the fixture history gateway (DEV·개발용, T1 API 없이)', () => {
  it('When asking for a provider Then the fixture page is served and a follow-up with after is empty', async () => {
    const gateway = createFixtureUsageHistoryGateway()
    const first = await gateway.fetchSamples('claude', { limit: 50, anchor: true, from: '2026-11-13T00:00:00.000Z' })
    expect(first.ok && first.page.samples.length).toBeGreaterThan(0)
    if (!first.ok) throw new Error('expected ok')
    const next = await gateway.fetchSamples('claude', { limit: 50, after: first.page.nextCursor ?? undefined })
    expect(next).toMatchObject({ ok: true, page: { samples: [], nextCursor: first.page.nextCursor, hasMore: false } })
  })
  it('Then the summary lists all six providers with ok counts from the fixtures', async () => {
    const result = await createFixtureUsageHistoryGateway().fetchSummary()
    expect(result.ok && result.summary.map((entry) => entry.provider)).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
  })
})
