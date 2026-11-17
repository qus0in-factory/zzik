import { describe, expect, it } from 'vitest'
import type { TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import { TREND_FREE_MODELS_RULE, TREND_SOURCE_OPENCODE_ZEN } from '../../../../shared/trend-contract'
import { buildFreeModels } from '../../../../worker/domain/trend/sections/free-models'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

function zenRecord(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'hy4-flash-free',
    provider: 'opencode',
    modelId: 'hy4-flash-free',
    name: 'Hy4 Flash Free',
    creator: 'tencent',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: NOW - DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: true,
    status: null,
    expiresAtMs: null,
    ...overrides,
  }
}

function catalogRecord(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'tencent/hy4-flash',
    provider: 'opencode',
    modelId: 'hy4-flash-free',
    name: 'Hy4 Flash Free',
    creator: 'tencent',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: NOW - DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: true,
    status: null,
    expiresAtMs: null,
    ...overrides,
  }
}

const okSource: TrendSourceState[] = [{ id: TREND_SOURCE_OPENCODE_ZEN, fetchedAt: new Date(NOW).toISOString(), status: 'ok' }]

function build(input: {
  zen?: TrendModelRecord[] | null
  catalog?: TrendModelRecord[] | null
  previous?: TrendSectionPayload | null
  sources?: TrendSourceState[]
}) {
  return buildFreeModels({
    zen: input.zen === undefined ? [] : input.zen,
    catalog: input.catalog ?? null,
    previous: input.previous ?? null,
    sources: input.sources ?? okSource,
    nowMs: NOW,
  })
}

describe('Given the OpenCode Zen zero-price free-models builder', () => {
  it('When Zen models include free, paid, deprecated, and >30d free models Then emits all active free models with recentlyAdded flag', () => {
    const payload = build({
      zen: [
        zenRecord(),
        zenRecord({
          canonicalId: 'big-pickle',
          modelId: 'big-pickle',
          name: 'Big Pickle',
          creator: '',
          releaseDate: '2026-09-01',
          releaseMs: NOW - 77 * DAY,
        }),
        zenRecord({
          canonicalId: 'paid-model',
          modelId: 'paid-model',
          name: 'Paid Model',
          price: { input: 1.5, output: 4.0 },
          free: false,
        }),
        zenRecord({
          canonicalId: 'old-deprecated-free',
          modelId: 'old-deprecated-free',
          name: 'Old Deprecated Free',
          status: 'deprecated',
        }),
      ],
      catalog: [
        catalogRecord({ canonicalId: 'opencode/big-pickle', modelId: 'big-pickle', name: 'Big Pickle', creator: 'opencode' }),
      ],
    })
    expect(payload.rule).toBe(TREND_FREE_MODELS_RULE)
    expect(payload.items).toHaveLength(2)
    expect(payload.items[0]).toMatchObject({
      id: 'hy4-flash-free',
      name: 'Hy4 Flash Free',
      free: true,
      price: { input: 0, output: 0 },
      freeKind: 'opencode-zen',
      recentlyAdded: true,
    })
    expect(payload.items[1]).toMatchObject({
      id: 'big-pickle',
      name: 'Big Pickle',
      creator: 'opencode',
      free: true,
      freeKind: 'opencode-zen',
      recentlyAdded: false,
    })
    expect(payload.sources).toEqual(okSource)
  })

  it('When Zen fetch fails or returns 304 (zen=null) Then preserves previous free items and source state', () => {
    const previous = build({ zen: [zenRecord()] })
    const staleSources: TrendSourceState[] = [{ id: TREND_SOURCE_OPENCODE_ZEN, fetchedAt: new Date(NOW).toISOString(), status: 'stale' }]
    const payload = build({ zen: null, previous, sources: staleSources })
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]?.id).toBe('hy4-flash-free')
    expect(payload.sources).toEqual(staleSources)
  })

  it('When Zen returns free models without releaseDate Then recentlyAdded is false and metadata still renders', () => {
    const payload = build({
      zen: [zenRecord({ canonicalId: 'iceman-free', modelId: 'iceman-free', name: 'Iceman Free', creator: '', releaseDate: null, releasePrecision: 'unknown', releaseMs: null })],
    })
    expect(payload.items[0]).toMatchObject({
      id: 'iceman-free',
      name: 'Iceman Free',
      creator: '',
      releaseDate: null,
      precision: 'unknown',
      recentlyAdded: false,
      freeKind: 'opencode-zen',
    })
  })
})
