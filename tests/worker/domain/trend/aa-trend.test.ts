import { describe, expect, it } from 'vitest'
import { buildAaTrendResponse } from '../../../../worker/domain/trend/metrics/aa'
import type { AaSnapshotRow } from '../../../../worker/domain/trend/metrics/types'

function row(index: number, overrides: Partial<AaSnapshotRow> = {}): AaSnapshotRow {
  return {
    day: '2026-11-17',
    slug: `model-${String(index).padStart(2, '0')}`,
    name: `Model ${index}`,
    creator: 'Org',
    intelligenceIndex: 90 - index,
    domains: {},
    priceIn: index,
    priceOut: index * 3,
    outputTokensPerSecond: 50 + index * 5,
    timeToFirstTokenSeconds: Number((0.4 + index * 0.2).toFixed(2)),
    releaseDate: '2026-11-10',
    indexVersion: '5.0',
    ...overrides,
  }
}

describe('Given AA snapshot rows for the internal /api/trend/aa endpoint', () => {
  it('When 15 rows exist Then computes top/bottom 10 lists using raw AA fields without synthetic scores', () => {
    const rows = Array.from({ length: 15 }, (_, idx) => row(idx + 1))
    rows[14] = row(15, { priceIn: null, priceOut: null, outputTokensPerSecond: 0, timeToFirstTokenSeconds: 0 })

    const response = buildAaTrendResponse(rows)
    expect(response).not.toBeNull()
    if (response === null) return

    expect(response.day).toBe('2026-11-17')
    expect(response.indexVersion).toBe('5.0')
    expect(response.attribution).toBe('Source: Artificial Analysis (artificialanalysis.ai)')

    expect(response.intelligenceTop).toHaveLength(10)
    expect(response.intelligenceTop[0]).toMatchObject({ slug: 'model-01', intelligenceIndex: 89 })
    expect(response.intelligenceTop[9]).toMatchObject({ slug: 'model-10', intelligenceIndex: 80 })

    expect(response.priceLowest).toHaveLength(10)
    expect(response.priceLowest[0]).toMatchObject({ slug: 'model-01', priceIn: 1, priceOut: 3 })
    expect(response.priceHighest).toHaveLength(10)
    expect(response.priceHighest[0]).toMatchObject({ slug: 'model-14', priceIn: 14, priceOut: 42 })

    expect(response.speedHighest).toHaveLength(10)
    expect(response.speedHighest[0]).toMatchObject({ slug: 'model-14', outputTokensPerSecond: 120 })
    expect(response.latencyLowest).toHaveLength(10)
    expect(response.latencyLowest[0]).toMatchObject({ slug: 'model-01', timeToFirstTokenSeconds: 0.6 })
  })

  it('When no rows exist Then returns null', () => {
    expect(buildAaTrendResponse([])).toBeNull()
  })
})
