import { describe, expect, it } from 'vitest'
import type { TrendPlanGroup, TrendSection, TrendSectionPayload, TrendSourceState } from '../../../../shared/trend-contract'
import { refreshPlanModels } from '../../../../worker/app/trend/refresh-plan-models'
import type { PlanObservation, PlanObservationRow, PlanSectionPayload, PlanSource, PlanStore } from '../../../../worker/domain/trend/plan/types'
import type { TrendModelRecord } from '../../../../worker/domain/trend/sources'
import type { TrendSectionRow } from '../../../../worker/domain/trend/store'

const NOW = Date.UTC(2026, 10, 17, 5, 0, 0)
const DAY = 86_400_000

class FakePlanStore implements PlanStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  observations: PlanObservationRow[] = []
  writes: TrendSection[] = []
  failUpsertFor: string | null = null
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.writes.push(payload.section)
    this.sections.set(payload.section, { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readObservations(): Promise<PlanObservationRow[]> { return this.observations }
  async upsertObservations(plan: string, source: string, observations: readonly PlanObservation[], nowMs: number): Promise<void> {
    if (this.failUpsertFor === source) throw new Error('storage failed')
    for (const observation of observations) {
      const existing = this.observations.find((row) => row.plan === plan && row.modelId === observation.modelId)
      if (existing !== undefined) {
        existing.lastSeenAt = nowMs
        continue
      }
      const baseline = !this.observations.some((row) => row.plan === plan)
      this.observations.push({
        plan, modelId: observation.modelId, displayName: observation.displayName,
        source, confidence: observation.confidence, firstSeenAt: nowMs, lastSeenAt: nowMs, baseline,
      })
    }
  }
}

const go: PlanSource = {
  id: 'go-models', plan: 'opencode-go',
  async fetch() {
    return { ok: true, observations: [{ plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog' }] }
  },
}
const ollama: PlanSource = {
  id: 'ollama-tags', plan: 'ollama-cloud',
  async fetch() {
    return { ok: true, observations: [{ plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog' }] }
  },
}
const failed: PlanSource = { id: 'go-models', plan: 'opencode-go', async fetch() { return { ok: false, reason: 'http', httpStatus: 500 } } }

const catalog: TrendModelRecord[] = [{
  canonicalId: 'anthropic/claude-fable-5', provider: 'anthropic', modelId: 'claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
  releaseDate: '2026-11-09', releasePrecision: 'day', releaseMs: Date.UTC(2026, 10, 9), price: null, free: false, openWeights: false, status: null,
}]

function payload(store: FakePlanStore): PlanSectionPayload {
  return JSON.parse(store.sections.get('plan-models')!.payload) as PlanSectionPayload
}

function group(store: FakePlanStore, id: string): TrendPlanGroup | undefined {
  return payload(store).plans.find((plan) => plan.id === id)
}

describe('Given the plan-models refresh', () => {
  it('When both public sources succeed Then stores baseline observations and writes availability notes', async () => {
    const store = new FakePlanStore()
    const result = await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    expect(result).toMatchObject({ ok: true, written: true, sources: { 'go-models': 'ok', 'ollama-tags': 'ok' } })
    expect(store.observations).toHaveLength(2)
    expect(store.observations.every((row) => row.baseline)).toBe(true)
    expect(payload(store).plans.map((plan) => plan.id)).toEqual(['grok', 'codex'])
    expect(group(store, 'codex')).toMatchObject({ status: 'unavailable', note: 'not_implemented' })
  })

  it('When later observations are not baseline Then groups the recent models', async () => {
    const store = new FakePlanStore()
    store.observations = [
      { plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
    ]
    const result = await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    expect(result).toMatchObject({ ok: true, written: true })
    expect(payload(store).plans.map((plan) => plan.id)).toEqual(['opencode-go', 'ollama-cloud', 'grok', 'codex'])
    expect(group(store, 'opencode-go')?.items).toHaveLength(1)
    expect(group(store, 'ollama-cloud')?.items).toHaveLength(1)
  })

  it('When a source fails after a good run Then keeps its prior items and marks only that group partial', async () => {
    const store = new FakePlanStore()
    store.observations = [
      { plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
    ]
    const result = await refreshPlanModels({ store, sources: [failed, ollama], catalog, nowMs: NOW + DAY })
    expect(result.sources['go-models']).toBe('stale')
    expect(result.sources['ollama-tags']).toBe('ok')
    expect(group(store, 'opencode-go')).toMatchObject({ status: 'partial', note: 'source_failed' })
    expect(group(store, 'opencode-go')?.items.map((item) => item.id)).toContain('deepseek/deepseek-v4.1-flash-1017')
    expect(group(store, 'ollama-cloud')?.status).toBe('ok')
  })

  it('When observation storage throws Then the other source still updates', async () => {
    const store = new FakePlanStore()
    store.failUpsertFor = 'go-models'
    store.observations = [
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
    ]
    const result = await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    expect(result.sources).toEqual({ 'go-models': 'stale', 'ollama-tags': 'ok' })
    expect(store.observations.map((row) => row.plan)).toEqual(['ollama-cloud'])
    expect(group(store, 'ollama-cloud')?.items).toHaveLength(1)
    expect(group(store, 'opencode-go')).toMatchObject({ status: 'unavailable', note: 'source_failed' })
  })

  it('When every source fails before any data exists Then does not create a section', async () => {
    const store = new FakePlanStore()
    const result = await refreshPlanModels({ store, sources: [failed, failed], catalog, nowMs: NOW })
    expect(result).toMatchObject({ ok: false, written: false })
    expect(store.sections.has('plan-models')).toBe(false)
  })

  it('When both sources succeed with no models Then writes Codex/Grok availability notes', async () => {
    const empty: PlanSource = { id: 'go-models', plan: 'opencode-go', async fetch() { return { ok: true, observations: [] } } }
    const empty2: PlanSource = { id: 'ollama-tags', plan: 'ollama-cloud', async fetch() { return { ok: true, observations: [] } } }
    const store = new FakePlanStore()
    const result = await refreshPlanModels({ store, sources: [empty, empty2], catalog, nowMs: NOW })
    expect(result).toMatchObject({ ok: true, written: true })
    expect(payload(store).plans.map((plan) => plan.id)).toEqual(['grok', 'codex'])
  })

  it('When both sources fail after a section exists Then keeps prior items and marks both groups partial', async () => {
    const store = new FakePlanStore()
    store.observations = [
      { plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
    ]
    await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    const result = await refreshPlanModels({ store, sources: [failed, { ...failed, id: 'ollama-tags', plan: 'ollama-cloud' }], catalog, nowMs: NOW + DAY })
    expect(result).toMatchObject({ ok: false, written: true })
    expect(group(store, 'opencode-go')).toMatchObject({ status: 'partial', note: 'source_failed' })
    expect(group(store, 'opencode-go')?.items).toHaveLength(1)
    expect(group(store, 'ollama-cloud')).toMatchObject({ status: 'partial', note: 'source_failed' })
    expect(payload(store).sources.every((source) => source.status === 'stale')).toBe(true)
  })

  it('When the same observations and sources are refreshed Then does not rewrite the section', async () => {
    const store = new FakePlanStore()
    store.observations = [
      { plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017', source: 'go-models', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
      { plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false },
    ]
    await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    store.writes = []
    const result = await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW + 3_600_000 })
    expect(result).toMatchObject({ ok: true, written: false })
    expect(store.writes).toEqual([])
  })

  it('When Claude display observations seed the store Then the section matches models.dev metadata', async () => {
    const store = new FakePlanStore()
    store.observations = [{
      plan: 'claude-max', modelId: 'claude-display:claude fable 5', displayName: 'Claude Fable 5', source: 'usage-keys',
      confidence: 'partial', firstSeenAt: NOW - DAY, lastSeenAt: NOW, baseline: false,
    }]
    const result = await refreshPlanModels({ store, sources: [go, ollama], catalog, nowMs: NOW })
    expect(result.written).toBe(true)
    expect(group(store, 'claude-max')?.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic', matched: true,
    })
  })
})
