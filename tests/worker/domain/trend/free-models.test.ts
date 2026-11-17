import { describe, expect, it } from 'vitest'
import type { TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import { TREND_FREE_MODELS_RULE, TREND_SOURCE_OPENCODE_GO } from '../../../../shared/trend-contract'
import { buildFreeModels } from '../../../../worker/domain/trend/sections/free-models'
import { decodeGoModels } from '../../../../worker/domain/trend/sources'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

function goRecord(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'tencent/hy4-flash',
    provider: 'opencode-go',
    modelId: 'hy4-flash-free',
    name: 'Hy4 flash Free',
    creator: 'tencent',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: NOW - DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: false,
    status: null,
    expiresAtMs: null,
    limitedTime: true,
    limitedRegions: false,
    link: 'https://opencode.ai/console/go#pricing',
    ...overrides,
  }
}

const okSources: TrendSourceState[] = [
  { id: TREND_SOURCE_OPENCODE_GO, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
]

function build(input: {
  goModels?: TrendModelRecord[] | null
  catalog?: TrendModelRecord[] | null
  previous?: TrendSectionPayload | null
  sources?: TrendSourceState[]
}) {
  return buildFreeModels({
    goModels: input.goModels === undefined ? [] : input.goModels,
    catalog: input.catalog ?? null,
    previous: input.previous ?? null,
    sources: input.sources ?? okSources,
    nowMs: NOW,
  })
}

describe('Given OpenCode Go decoder', () => {
  it('When decoding Go API JSON Then extracts price-0 free models with limited_regions and limitedTime', () => {
    const decoded = decodeGoModels({
      object: 'list',
      data: [
        {
          id: 'beam-free',
          name: 'Beam Free',
          canonical_id: 'reflection/beam-1.0-501b-a23b',
          release_date: '2026-10-05',
          open_weights: true,
          cost: { text: { input: { price: 0 }, output: { price: 0 } } },
          go: { monthly_usage: null, limited_regions: true },
        },
        {
          id: 'paid-go',
          name: 'Paid Go',
          cost: { text: { input: { price: 1 }, output: { price: 2 } } },
          go: { monthly_usage: 100, limited_regions: false },
        },
      ],
    })
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.value.filter((r) => r.free)).toEqual([
      expect.objectContaining({
        modelId: 'beam-free',
        name: 'Beam Free',
        free: true,
        limitedRegions: true,
        limitedTime: true,
        link: 'https://opencode.ai/console/go#pricing',
      }),
    ])
  })
})

describe('Given the OpenCode Go free-models builder', () => {
  it('When Go free models exist Then emits opencode-go items with badges and pricing link', () => {
    const payload = build({
      goModels: [
        goRecord(),
        goRecord({
          canonicalId: 'reflection/beam-1.0-501b-a23b',
          modelId: 'beam-free',
          name: 'Beam Free',
          releaseDate: '2026-10-05',
          releaseMs: NOW - 43 * DAY,
          limitedRegions: true,
        }),
        goRecord({ canonicalId: 'paid', modelId: 'paid', free: false, price: { input: 1, output: 2 } }),
      ],
    })
    expect(payload.rule).toBe(TREND_FREE_MODELS_RULE)
    expect(payload.items).toHaveLength(2)
    expect(payload.items[0]).toMatchObject({
      id: 'tencent/hy4-flash',
      freeKind: 'opencode-go',
      limitedTime: true,
      limitedRegions: false,
      recentlyAdded: true,
      links: { opencode: 'https://opencode.ai/console/go#pricing' },
    })
    expect(payload.items[1]).toMatchObject({
      id: 'reflection/beam-1.0-501b-a23b',
      freeKind: 'opencode-go',
      limitedTime: true,
      limitedRegions: true,
      recentlyAdded: false,
    })
  })

  it('When Go source fails or returns 304 (goModels=null) Then preserves previous items', () => {
    const previous = build({ goModels: [goRecord()] })
    const payload = build({ goModels: null, previous })
    expect(payload.items.map((i) => i.id)).toEqual(['tencent/hy4-flash'])
  })

  it('When models.dev is 304 (catalog=null) Then carries creator, releaseDate, precision, and openWeights from previous items', () => {
    const previous = build({
      goModels: [goRecord({ creator: '', releaseDate: null, releasePrecision: 'unknown', releaseMs: null, openWeights: false })],
      catalog: [{
        ...goRecord(),
        canonicalId: 'tencent/hy4-flash',
        creator: 'tencent',
        releaseDate: '2026-11-16',
        releasePrecision: 'day',
        releaseMs: NOW - DAY,
        openWeights: true,
      }],
    })
    const payload = build({
      goModels: [goRecord({ creator: '', releaseDate: null, releasePrecision: 'unknown', releaseMs: null, openWeights: false })],
      catalog: null,
      previous,
    })
    expect(payload.items[0]).toMatchObject({
      id: 'tencent/hy4-flash',
      creator: 'tencent',
      releaseDate: '2026-11-16',
      precision: 'day',
      openWeights: true,
    })
  })
})
