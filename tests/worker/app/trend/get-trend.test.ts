import { describe, expect, it } from 'vitest'
import { getTrendIndex } from '../../../../worker/app/trend/get-trend'
import type { TrendSectionPayload } from '../../../../shared/trend-contract'
import type { TrendStore } from '../../../../worker/domain/trend/store'

function storeWith(payload: TrendSectionPayload): TrendStore {
  const row = { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) }
  return {
    async readSection() { return row },
    async readSections() { return [row] },
    async writeSection() { return 'a'.repeat(64) },
    async readSourceState() { return null },
    async writeSourceState() {},
  }
}

describe('Given the public trend index', () => {
  it('When metrics has no items but block entries Then the count includes the block entries', async () => {
    const payload: TrendSectionPayload = {
      section: 'metrics', schemaVersion: 1, generatedAt: '2026-11-17T05:00:00.000Z', rule: 'x',
      sources: [], items: [],
      blocks: [{ id: 'or-usage', status: 'ok', asOf: '2026-11-17T04:00:00Z', entries: [{ id: 'a/x', name: 'A X', creator: '', rank: 1, rankDelta: null, kind: 'steady' }, { id: 'b/x', name: 'B X', creator: '', rank: 2, rankDelta: null, kind: 'steady' }], attribution: 'x' }],
    }
    const index = await getTrendIndex(storeWith(payload))
    expect(index?.sections).toEqual([expect.objectContaining({ id: 'metrics', count: 2 })])
  })
})
