import { describe, expect, it } from 'vitest'
import type { TrendSectionPayload } from '../../../../shared/trend-contract'
import { TREND_FREE_MODELS_RULE } from '../../../../shared/trend-contract'
import { buildFreeModels } from '../../../../worker/domain/trend/sections/free-models'
import type { PlanObservationRow } from '../../../../worker/domain/trend/plan/types'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const HOUR = 3_600_000
const DAY = 86_400_000

function observation(overrides: Partial<PlanObservationRow> = {}): PlanObservationRow {
  return {
    plan: 'opencode-go',
    modelId: 'deepseek/deepseek-v4.1-flash-1017',
    displayName: 'DeepSeek V4.1 Flash 1017',
    source: 'go-models',
    confidence: 'catalog',
    firstSeenAt: NOW - DAY,
    lastSeenAt: NOW - HOUR,
    baseline: false,
    ...overrides,
  }
}

function record(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'deepseek/deepseek-v4.1-flash-1017',
    provider: 'opencode-go',
    modelId: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash 1017',
    creator: 'deepseek',
    releaseDate: '2026-10-17',
    releasePrecision: 'day',
    releaseMs: Date.UTC(2026, 9, 17),
    price: { input: 0.15, output: 0.6 },
    free: false,
    openWeights: true,
    status: null,
    expiresAtMs: null,
    ...overrides,
  }
}

function build(input: {
  observations?: PlanObservationRow[]
  catalog?: TrendModelRecord[] | null
  previous?: TrendSectionPayload | null
}) {
  return buildFreeModels({
    observations: input.observations ?? [],
    catalog: input.catalog ?? null,
    previous: input.previous ?? null,
    nowMs: NOW,
  })
}

describe('Given the plan-included free-models builder', () => {
  it('When Go and Ollama observations exist Then emits two groups with metadata and plan-included pricing', () => {
    const payload = build({
      observations: [
        observation(),
        observation({ plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags' }),
      ],
      catalog: [
        record(),
        record({ canonicalId: 'zhipuai/glm-5.3', provider: 'ollama-cloud', modelId: 'glm-5.3', name: 'GLM 5.3', creator: 'zhipuai', releaseDate: '2026-08-14', releaseMs: Date.UTC(2026, 7, 14), price: null }),
      ],
    })
    expect(payload.rule).toBe(TREND_FREE_MODELS_RULE)
    expect(payload.items.map((item) => item.freeKind)).toEqual(['opencode-go', 'ollama-cloud'])
    expect(payload.items[0]).toMatchObject({
      id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017', creator: 'deepseek',
      price: { input: 0, output: 0 }, free: true, openWeights: true, freeKind: 'opencode-go',
    })
    expect(payload.items[1]).toMatchObject({ id: 'zhipuai/glm-5.3', name: 'GLM 5.3', freeKind: 'ollama-cloud' })
    expect(payload.sources).toEqual([
      { id: 'go-models', fetchedAt: new Date(NOW - HOUR).toISOString(), status: 'ok' },
      { id: 'ollama-tags', fetchedAt: new Date(NOW - HOUR).toISOString(), status: 'ok' },
    ])
  })

  it('When an observation has no models.dev match Then keeps the display name and empty creator', () => {
    const payload = build({ observations: [observation({ modelId: 'new/model-x', displayName: 'Model X' })] })
    expect(payload.items[0]).toMatchObject({ id: 'new/model-x', name: 'Model X', creator: '', releaseDate: null, precision: 'unknown', freeKind: 'opencode-go' })
  })

  it('When the last observation is older than 12 hours Then keeps items but marks the source stale', () => {
    const payload = build({ observations: [observation({ lastSeenAt: NOW - 13 * HOUR })] })
    expect(payload.items).toHaveLength(1)
    expect(payload.sources.find((source) => source.id === 'go-models')?.status).toBe('stale')
  })

  it('When a plan has no current observations Then carries the previous group items', () => {
    const previous = build({ observations: [observation()] })
    const payload = build({ observations: [], previous })
    expect(payload.items.map((item) => item.freeKind)).toEqual(['opencode-go'])
    expect(payload.sources.find((source) => source.id === 'go-models')?.status).toBe('stale')
  })

  it('When an observation is older than the 7-day window Then excludes it', () => {
    const payload = build({ observations: [observation({ lastSeenAt: NOW - 8 * DAY })] })
    expect(payload.items).toEqual([])
  })

  it('When there is no data Then returns two stale sources and no items', () => {
    const payload = build({})
    expect(payload.items).toEqual([])
    expect(payload.sources.map((source) => [source.id, source.status])).toEqual([
      ['go-models', 'stale'], ['ollama-tags', 'stale'],
    ])
  })
})
