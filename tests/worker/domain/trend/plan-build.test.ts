import { describe, expect, it } from 'vitest'
import type { TrendPlanGroup, TrendSourceState } from '../../../../shared/trend-contract'
import { buildPlanModels } from '../../../../worker/domain/trend/plan/build'
import type { PlanObservationRow, PlanSectionPayload } from '../../../../worker/domain/trend/plan/types'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

function observation(overrides: Partial<PlanObservationRow> = {}): PlanObservationRow {
  return {
    plan: 'opencode-go',
    modelId: 'deepseek/deepseek-v4.1-flash-1017',
    displayName: 'DeepSeek V4.1 Flash 1017',
    source: 'go-models',
    confidence: 'catalog',
    firstSeenAt: NOW - DAY,
    lastSeenAt: NOW,
    baseline: false,
    ...overrides,
  }
}

function record(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'anthropic/claude-fable-5',
    provider: 'anthropic',
    modelId: 'claude-fable-5',
    name: 'Claude Fable 5',
    creator: 'anthropic',
    releaseDate: '2026-11-09',
    releasePrecision: 'day',
    releaseMs: Date.UTC(2026, 10, 9),
    price: null,
    free: false,
    openWeights: false,
    status: null,
    ...overrides,
  }
}

function sources(status: 'ok' | 'stale' = 'ok'): TrendSourceState[] {
  return [
    { id: 'go-models', fetchedAt: new Date(NOW).toISOString(), status },
    { id: 'ollama-tags', fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
  ]
}

function build(input: {
  observations?: PlanObservationRow[]
  catalog?: TrendModelRecord[] | null
  previous?: PlanSectionPayload | null
  sourceStates?: TrendSourceState[]
}) {
  return buildPlanModels({
    observations: input.observations ?? [],
    catalog: input.catalog ?? null,
    sources: input.sourceStates ?? sources(),
    previous: input.previous ?? null,
    nowMs: NOW,
  })
}

function group(payload: PlanSectionPayload, id: string): TrendPlanGroup | undefined {
  return payload.plans.find((plan) => plan.id === id)
}

describe('Given the plan-models builder', () => {
  it('When first_seen is on the 14-day boundary Then includes it; older, future or baseline rows are excluded', () => {
    const payload = build({
      observations: [
        observation({ modelId: 'in', firstSeenAt: NOW - 14 * DAY }),
        observation({ modelId: 'out', firstSeenAt: NOW - 14 * DAY - 1 }),
        observation({ modelId: 'future', firstSeenAt: NOW + DAY }),
        observation({ modelId: 'baseline', baseline: true }),
      ],
    })
    expect(group(payload, 'opencode-go')?.items.map((item) => item.id)).toEqual(['in'])
  })

  it('When several plans have items Then emits groups in the fixed order and keeps Codex unavailable', () => {
    const payload = build({
      observations: [
        observation(),
        observation({ plan: 'ollama-cloud', source: 'ollama-tags', modelId: 'glm-5.3', displayName: 'glm-5.3' }),
        observation({ plan: 'antigravity', source: 'agy-cli', modelId: 'gemini-4-argon', displayName: 'Gemini 4 Argon', confidence: 'account' }),
      ],
    })
    expect(payload.plans.map((plan) => plan.id)).toEqual(['opencode-go', 'ollama-cloud', 'antigravity', 'grok', 'codex'])
    expect(group(payload, 'grok')).toMatchObject({ status: 'unavailable', note: 'unverified', items: [] })
    expect(group(payload, 'codex')).toMatchObject({ status: 'unavailable', note: 'not_implemented', items: [] })
  })

  it('When a Claude display key matches a models.dev name Then enriches id, creator and release date', () => {
    const payload = build({
      observations: [observation({
        plan: 'claude-max', source: 'usage-keys', modelId: 'claude-display:claude fable 5',
        displayName: 'Claude Fable 5', confidence: 'partial',
      })],
      catalog: [record()],
    })
    const claude = group(payload, 'claude-max')
    expect(claude).toMatchObject({ status: 'partial', note: 'partial_judgement' })
    expect(claude?.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
      releaseDate: '2026-11-09', precision: 'day', matched: true, confidence: 'partial',
    })
  })

  it('When a Claude display key has no match Then keeps the display name only', () => {
    const payload = build({
      observations: [observation({
        plan: 'claude-max', source: 'usage-keys', modelId: 'claude-display:unknown model',
        displayName: 'Unknown Model', confidence: 'partial',
      })],
    })
    expect(group(payload, 'claude-max')?.items[0]).toMatchObject({
      id: 'claude-display:unknown model', name: 'Unknown Model', creator: null,
      releaseDate: null, precision: 'unknown', matched: false,
    })
  })

  it('When explicit and display observations map to the same canonical id Then merges them with the best confidence', () => {
    const payload = build({
      observations: [
        observation({
          plan: 'claude-max', source: 'usage-keys', modelId: 'claude-fable-5',
          displayName: 'Claude Fable 5', confidence: 'account', firstSeenAt: NOW - 3 * DAY,
        }),
        observation({
          plan: 'claude-max', source: 'usage-keys', modelId: 'claude-display:claude fable 5',
          displayName: 'Claude Fable 5', confidence: 'partial', firstSeenAt: NOW - 5 * DAY,
        }),
      ],
      catalog: [record()],
    })
    const items = group(payload, 'claude-max')?.items ?? []
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'anthropic/claude-fable-5', confidence: 'account' })
    expect(items[0]?.firstSeenAt).toBe(new Date(NOW - 5 * DAY).toISOString())
    expect(items[0]?.extra?.rawIds).toContain('claude-fable-5')
    expect(items[0]?.extra?.rawIds).toContain('claude-display:claude fable 5')
  })

  it('When the source is stale Then keeps items as partial, or marks the empty group unavailable', () => {
    const withItems = build({
      observations: [observation()],
      sourceStates: sources('stale'),
    })
    expect(group(withItems, 'opencode-go')).toMatchObject({ status: 'partial', note: 'source_failed' })
    const empty = build({ observations: [], sourceStates: sources('stale') })
    expect(group(empty, 'opencode-go')).toMatchObject({ status: 'unavailable', note: 'source_failed', items: [] })
  })

  it('When a successful source has no new items Then omits that empty group but keeps unavailable notes', () => {
    const payload = build({ observations: [] })
    expect(group(payload, 'opencode-go')).toBeUndefined()
    expect(payload.plans.map((plan) => plan.id)).toEqual(['grok', 'codex'])
  })

  it('When models.dev metadata is missing on a later run Then reuses the previous matched item by raw id', () => {
    const previous = {
      section: 'plan-models' as const, schemaVersion: 1, generatedAt: new Date(NOW - DAY).toISOString(),
      rule: 'plan-observation-14d', sources: sources(), items: [],
      plans: [{
        id: 'claude-max', status: 'partial' as const, items: [{
          id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
          releaseDate: '2026-11-09', precision: 'day' as const, firstSeenAt: new Date(NOW - 2 * DAY).toISOString(),
          confidence: 'partial' as const, source: 'usage-keys', matched: true,
          extra: { rawIds: 'claude-display:claude fable 5' },
        }],
      }],
    }
    const payload = build({
      observations: [observation({
        plan: 'claude-max', source: 'usage-keys', modelId: 'claude-display:claude fable 5',
        displayName: 'Claude Fable 5', confidence: 'partial',
      })],
      catalog: null,
      previous,
    })
    expect(group(payload, 'claude-max')?.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', creator: 'anthropic', releaseDate: '2026-11-09', matched: true,
    })
  })

  it('When a plan item is partial Then the group carries the partial judgement note', () => {
    const payload = build({
      observations: [observation({ plan: 'antigravity', source: 'agy-cli', modelId: 'gpt-oss', displayName: 'GPT-OSS', confidence: 'partial' })],
    })
    expect(group(payload, 'antigravity')).toMatchObject({ status: 'partial', note: 'partial_judgement' })
  })
})
