import { describe, expect, it } from 'vitest'
import {
  TREND_FREE_MODELS_RULE,
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
} from '../../../../shared/trend-contract'
import { buildFreeModels } from '../../../../worker/domain/trend/sections/free-models'
import type { FreeModelsSourceData } from '../../../../worker/domain/trend/sections/free-models'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 0, 0, 0)
const DAY = 86_400_000

function record(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'tencent/hy4-flash',
    provider: 'openrouter',
    modelId: 'tencent/hy4-flash:free',
    name: 'Hy4 Flash',
    creator: 'tencent',
    releaseDate: '2026-11-16',
    releasePrecision: 'day',
    releaseMs: NOW - DAY,
    price: { input: 0, output: 0 },
    free: true,
    openWeights: false,
    status: null,
    expiresAtMs: null,
    ...overrides,
  }
}

const zen = (records: readonly TrendModelRecord[] | null, overrides: Partial<FreeModelsSourceData> = {}): FreeModelsSourceData => ({
  id: TREND_SOURCE_OPENCODE_ZEN, kind: 'hosted', status: 'ok', fetchedAt: new Date(NOW).toISOString(), records, carried: [], ...overrides,
})
const or = (records: readonly TrendModelRecord[] | null, overrides: Partial<FreeModelsSourceData> = {}): FreeModelsSourceData => ({
  id: TREND_SOURCE_OPENROUTER, kind: 'hosted', status: 'ok', fetchedAt: new Date(NOW).toISOString(), records, carried: [], ...overrides,
})
const md = (records: readonly TrendModelRecord[] | null, overrides: Partial<FreeModelsSourceData> = {}): FreeModelsSourceData => ({
  id: TREND_SOURCE_MODELS_DEV, kind: 'local', status: 'ok', fetchedAt: new Date(NOW).toISOString(), records, carried: [], ...overrides,
})

describe('Given the free-models builder', () => {
  it('When hosted records sit on the 30-day boundary Then keeps the inclusive day and drops older/future/deprecated/expired', () => {
    const payload = buildFreeModels([
      zen([
        record({ canonicalId: 'boundary-in', modelId: 'boundary-in:free', releaseDate: '2026-10-18', releaseMs: NOW - 30 * DAY }),
        record({ canonicalId: 'boundary-out', modelId: 'boundary-out:free', releaseDate: '2026-10-17', releaseMs: NOW - 31 * DAY }),
        record({ canonicalId: 'future', modelId: 'future:free', releaseMs: NOW + DAY }),
        record({ canonicalId: 'deprecated', modelId: 'deprecated:free', status: 'deprecated' }),
        record({ canonicalId: 'expired', modelId: 'expired:free', expiresAtMs: NOW - DAY }),
      ]),
      or([]),
      md([]),
    ], NOW)
    expect(payload.section).toBe('free-models')
    expect(payload.rule).toBe(TREND_FREE_MODELS_RULE)
    expect(payload.items.map((item) => item.id)).toEqual(['boundary-in'])
    expect(payload.items[0]).toMatchObject({ freeKind: 'hosted', free: true, price: { input: 0, output: 0 } })
  })

  it('When both hosted sources list the same canonical model Then merges providers and keeps the Zen vendor release', () => {
    const payload = buildFreeModels([
      zen([record({ provider: 'opencode', modelId: 'hy4-flash-free', name: 'Hy4 Flash Free', releaseDate: '2026-11-16', releaseMs: NOW - DAY })]),
      or([record({ provider: 'openrouter', name: 'Tencent: Hy4 flash', releaseDate: '2026-11-15', releaseMs: NOW - 2 * DAY })]),
      md([]),
    ], NOW)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'tencent/hy4-flash', name: 'Hy4 Flash Free', releaseDate: '2026-11-16',
      providers: ['opencode', 'openrouter'], freeKind: 'hosted',
    })
  })

  it('When a local model is also hosted free Then hosted wins and the local provider is merged', () => {
    const payload = buildFreeModels([
      zen([record({ provider: 'opencode', canonicalId: 'xiaomi/mimo-v2.6-flash', modelId: 'mimo-v2.6-flash-free' })]),
      or([]),
      md([record({
        canonicalId: 'xiaomi/mimo-v2.6-flash', provider: 'ollama-cloud', modelId: 'mimo-v2.6-flash',
        name: 'MiMo V2.6 Flash', free: false, price: null, openWeights: true,
      })]),
    ], NOW)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      id: 'xiaomi/mimo-v2.6-flash', freeKind: 'hosted', openWeights: true,
      providers: ['ollama-cloud', 'opencode'],
    })
    expect(payload.sourceItems[TREND_SOURCE_MODELS_DEV]).toHaveLength(1)
  })

  it('When local models are open-weight ollama-cloud entries Then lists them after hosted items with no price', () => {
    const payload = buildFreeModels([
      zen([]),
      or([]),
      md([
        record({ canonicalId: 'qwen/qwen4-max', provider: 'ollama-cloud', modelId: 'qwen4-max', name: 'Qwen4 Max', free: false, price: null, openWeights: true, releaseMs: NOW - 2 * DAY }),
        record({ canonicalId: 'cloud-only', provider: 'ollama-cloud', modelId: 'cloud-only', name: 'Cloud Only', free: false, price: null, openWeights: false }),
        record({ canonicalId: 'reseller', provider: 'openrouter', modelId: 'reseller', openWeights: true }),
      ]),
    ], NOW)
    expect(payload.items.map((item) => item.id)).toEqual(['qwen/qwen4-max'])
    expect(payload.items[0]).toMatchObject({ freeKind: 'local', free: false, price: null, openWeights: true, providers: ['ollama-cloud'] })
  })

  it('When a source returns 304 Then reuses carried items and re-applies the 30-day window', () => {
    const built = buildFreeModels([
      zen([record({ canonicalId: 'kept' })]),
      or([record({ canonicalId: 'expires', releaseMs: NOW - 29 * DAY, releaseDate: '2026-10-19' })]),
      md([]),
    ], NOW)
    const payload = buildFreeModels([
      zen(null, { carried: built.sourceItems[TREND_SOURCE_OPENCODE_ZEN] ?? [] }),
      or(null, { carried: built.sourceItems[TREND_SOURCE_OPENROUTER] ?? [] }),
      md(null),
    ], NOW + 2 * DAY)
    expect(payload.items.map((item) => item.id)).toEqual(['kept'])
    expect(payload.sources.every((source) => source.status === 'ok')).toBe(true)
  })

  it('When a source fails Then keeps its carried items and marks only that source stale', () => {
    const built = buildFreeModels([
      zen([record({ canonicalId: 'zen-item' })]),
      or([record({ canonicalId: 'or-item', provider: 'openrouter', modelId: 'or-item:free' })]),
      md([]),
    ], NOW)
    const payload = buildFreeModels([
      zen(null, { status: 'stale', carried: built.sourceItems[TREND_SOURCE_OPENCODE_ZEN] ?? [] }),
      or([record({ canonicalId: 'or-item', provider: 'openrouter', modelId: 'or-item:free' })]),
      md([]),
    ], NOW)
    expect(payload.items.map((item) => item.id).sort()).toEqual(['or-item', 'zen-item'])
    expect(payload.sources.find((source) => source.id === TREND_SOURCE_OPENCODE_ZEN)?.status).toBe('stale')
    expect(payload.sources.find((source) => source.id === TREND_SOURCE_OPENROUTER)?.status).toBe('ok')
  })

  it('When every source returns 200 with no free items Then writes a valid empty list, not a failure', () => {
    const payload = buildFreeModels([zen([]), or([]), md([])], NOW)
    expect(payload.items).toEqual([])
    expect(payload.sources).toHaveLength(3)
  })
})
