import { describe, expect, it } from 'vitest'
import { TREND_NEW_MODELS_RULE, TREND_SOURCE_MODELS_DEV } from '../../../../shared/trend-contract'
import { buildNewModels, reevaluateNewModels } from '../../../../worker/domain/trend/sections/new-models'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 0, 0, 0)

function record(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'anthropic/claude-x',
    provider: 'anthropic',
    modelId: 'claude-x',
    name: 'Claude X',
    creator: 'anthropic',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: Date.UTC(2026, 10, 16),
    price: { input: 3, output: 15 },
    free: false,
    openWeights: false,
    status: null,
    ...overrides,
  }
}

describe('Given the new-models section builder', () => {
  it('When release dates sit on the 7-day and 30-day UTC boundaries Then only the inclusive side is included', () => {
    const items = buildNewModels([
      record({ canonicalId: 'a', releaseDate: '2026-11-10', releaseMs: Date.UTC(2026, 10, 10) }),
      record({ canonicalId: 'b', releaseDate: '2026-11-09', releaseMs: Date.UTC(2026, 10, 9) }),
      record({ canonicalId: 'c', releaseDate: '2026-10-18', releaseMs: Date.UTC(2026, 9, 18) }),
      record({ canonicalId: 'd', releaseDate: '2026-10-17', releaseMs: Date.UTC(2026, 9, 17) }),
    ], new Map([['b', Date.UTC(2026, 9, 1)], ['c', Date.UTC(2026, 10, 12)], ['d', Date.UTC(2026, 10, 12)]]), NOW)
    expect(items.items.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('When first_seen is recent and release is within 30 days Then an older-day model is included; a 31-day model is not', () => {
    const items = buildNewModels([
      record({ canonicalId: 'seen-23d', releaseDate: '2026-10-25', releaseMs: Date.UTC(2026, 9, 25) }),
      record({ canonicalId: 'seen-31d', releaseDate: '2026-10-17', releaseMs: Date.UTC(2026, 9, 17) }),
    ], new Map([['seen-23d', Date.UTC(2026, 10, 12)], ['seen-31d', Date.UTC(2026, 10, 12)]]), NOW)
    expect(items.items.map((item) => item.id)).toEqual(['seen-23d'])
  })

  it('When first_seen is older than 7 days Then it does not revive a model whose release is older than 30 days', () => {
    const items = buildNewModels([
      record({ canonicalId: 'old', releaseDate: '2026-10-19', releaseMs: Date.UTC(2026, 9, 19) }),
    ], new Map([['old', Date.UTC(2026, 10, 9)]]), NOW)
    expect(items.items).toHaveLength(0)
  })

  it('When the same canonical model comes from several providers Then emits one item with sorted providers', () => {
    const items = buildNewModels([
      record({ canonicalId: 'deepseek/x', provider: 'openrouter', name: 'X', releaseDate: '2026-11-15', releaseMs: Date.UTC(2026, 10, 15) }),
      record({ canonicalId: 'deepseek/x', provider: 'ollama-cloud', name: 'X', releaseDate: '2026-11-14', releaseMs: Date.UTC(2026, 10, 14) }),
      record({ canonicalId: 'deepseek/x', provider: 'anthropic', name: 'X', releaseDate: '2026-11-16', releaseMs: Date.UTC(2026, 10, 16) }),
    ], new Map(), NOW)
    expect(items.items).toHaveLength(1)
    expect(items.items[0]).toMatchObject({ id: 'deepseek/x', providers: ['anthropic', 'ollama-cloud', 'openrouter'], releaseDate: '2026-11-16' })
  })

  it('When models are deprecated, future-dated or month-precision Then applies the intended filters', () => {
    const items = buildNewModels([
      record({ canonicalId: 'deprecated', status: 'deprecated' }),
      record({ canonicalId: 'future', releaseDate: '2026-11-18', releaseMs: Date.UTC(2026, 10, 18) }),
      record({ canonicalId: 'month', releaseDate: '2026-11', releasePrecision: 'month', releaseMs: Date.UTC(2026, 10, 1) }),
    ], new Map([['month', Date.UTC(2026, 10, 12)]]), NOW)
    expect(items.items.map((item) => item.id)).toEqual(['month'])
    expect(items.items[0]).toMatchObject({ precision: 'month', releaseDate: '2026-11' })
  })

  it('When the section is built Then carries the source, rule and generated timestamp', () => {
    const items = buildNewModels([record()], new Map(), NOW)
    expect(items).toMatchObject({ section: 'new-models', schemaVersion: 1, rule: TREND_NEW_MODELS_RULE })
    expect(items.sources).toEqual([{ id: TREND_SOURCE_MODELS_DEV, fetchedAt: new Date(NOW).toISOString(), status: 'ok' }])
    expect(items.generatedAt).toBe(new Date(NOW).toISOString())
  })

  it('When items are re-evaluated on a later 304 Then stores normalization metadata and drops expired items', () => {
    const built = buildNewModels([record()], new Map(), NOW)
    expect(built.items[0]?.extra).toEqual({ firstSeenAt: NOW, releaseMs: Date.UTC(2026, 10, 16) })
    const same = reevaluateNewModels(built, NOW + 86_400_000)
    expect(same?.items.map((item) => item.id)).toEqual(['anthropic/claude-x'])
    const expired = reevaluateNewModels(built, NOW + 8 * 86_400_000)
    expect(expired?.items).toEqual([])
    expect(expired?.generatedAt).toBe(new Date(NOW + 8 * 86_400_000).toISOString())
  })

  it('When stored items predate the metadata Then re-evaluation refuses so the caller can refetch', () => {
    const built = buildNewModels([record()], new Map(), NOW)
    const legacy = { ...built, items: built.items.map(({ extra: _extra, ...item }) => item) }
    expect(reevaluateNewModels(legacy, NOW)).toBeNull()
  })
})
