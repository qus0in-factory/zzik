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
  it('When 25 rows exist Then computes intelligence/cost/price top 20 and speed/latency top 10 from raw AA fields', () => {
    const rows = Array.from({ length: 25 }, (_, idx) => row(idx + 1, { costPerTask: Number(((25 - idx) / 100).toFixed(2)) }))
    rows[24] = row(25, { priceIn: null, priceOut: null, outputTokensPerSecond: 0, timeToFirstTokenSeconds: 0, costPerTask: null })

    const response = buildAaTrendResponse(rows)
    expect(response).not.toBeNull()
    if (response === null) return

    expect(response.day).toBe('2026-11-17')
    expect(response.indexVersion).toBe('5.0')
    expect(response.attribution).toBe('Source: Artificial Analysis (artificialanalysis.ai)')

    expect(response.intelligenceTop).toHaveLength(20)
    expect(response.intelligenceTop[0]).toMatchObject({ slug: 'model-01', intelligenceIndex: 89 })
    expect(response.intelligenceTop[19]).toMatchObject({ slug: 'model-20', intelligenceIndex: 70 })

    expect(response.priceLowest).toHaveLength(20)
    expect(response.priceLowest[0]).toMatchObject({ slug: 'model-01', priceIn: 1, priceOut: 3 })
    expect(response.costLowest).toHaveLength(20)
    expect(response.costLowest[0]).toMatchObject({ slug: 'model-24', costPerTask: 0.02 })

    expect(response.speedHighest).toHaveLength(10)
    expect(response.speedHighest[0]).toMatchObject({ slug: 'model-24', outputTokensPerSecond: 170 })
    expect(response.latencyLowest).toHaveLength(10)
    expect(response.latencyLowest[0]).toMatchObject({ slug: 'model-01', timeToFirstTokenSeconds: 0.6 })
  })

  it('When rows exist Then intelligence shows 20 and the cost table sorts by cost per task ascending', () => {
    const rows = Array.from({ length: 25 }, (_, idx) => row(idx + 1, {
      costPerTask: idx === 24 ? null : Number(((25 - idx) / 100).toFixed(2)),
    }))
    const response = buildAaTrendResponse(rows)
    expect(response).not.toBeNull()
    if (response === null) return
    expect(response.intelligenceTop).toHaveLength(20)
    expect(response.costLowest).toHaveLength(20)
    expect(response.costLowest.map((item) => item.slug)).toEqual(
      [...rows].filter((r) => r.costPerTask !== null)
        .sort((a, b) => a.costPerTask! - b.costPerTask! || a.slug.localeCompare(b.slug))
        .slice(0, 20).map((r) => r.slug),
    )
    expect(response).not.toHaveProperty('priceHighest')
  })

  it('When no rows exist Then returns null', () => {
    expect(buildAaTrendResponse([])).toBeNull()
  })
})
