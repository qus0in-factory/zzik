import { describe, expect, it } from 'vitest'
import {
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_GO,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
} from '../../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { refreshTrendSections } from '../../../../worker/app/trend/refresh-trend'
import type { PlanObservationRow } from '../../../../worker/domain/trend/plan/types'
import type { TrendModelRecord, TrendSource } from '../../../../worker/domain/trend/sources'
import type { TrendSectionRow, TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../../../worker/domain/trend/store'

const NOW = Date.UTC(2026, 10, 17, 0, 0, 0)
const DAY = 86_400_000
const HOUR = 3_600_000

function model(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'anthropic/claude-x', provider: 'anthropic', modelId: 'claude-x',
    name: 'Claude X', creator: 'anthropic', releaseDate: '2026-11-16', releasePrecision: 'day',
    releaseMs: NOW - DAY, price: { input: 3, output: 15 }, free: false, openWeights: false, status: null, expiresAtMs: null,
    ...overrides,
  }
}

function orModel(id: string, overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return model({
    canonicalId: id, provider: 'openrouter', modelId: id, name: id, creator: id.split('/')[0] ?? 'openrouter',
    releaseDate: '2026-11-15', releaseMs: NOW - 2 * DAY, price: null, ...overrides,
  })
}

function observation(overrides: Partial<PlanObservationRow> = {}): PlanObservationRow {
  return {
    plan: 'opencode-go', modelId: 'deepseek/deepseek-v4.1-flash-1017', displayName: 'DeepSeek V4.1 Flash 1017',
    source: 'go-models', confidence: 'catalog', firstSeenAt: NOW - DAY, lastSeenAt: NOW - HOUR, baseline: false,
    ...overrides,
  }
}

class FakeStore implements TrendStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  sources = new Map<string, TrendSourceStateRow>()
  seen: TrendSeenRow[] = []
  planObservations: PlanObservationRow[] = []
  writes: TrendSection[] = []
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async readSections(): Promise<TrendSectionRow[]> { return [...this.sections.values()] }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.writes.push(payload.section)
    this.sections.set(payload.section, {
      section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt),
    })
    return 'a'.repeat(64)
  }
  async readSourceState(source: string): Promise<TrendSourceStateRow | null> { return this.sources.get(source) ?? null }
  async writeSourceState(row: TrendSourceStateRow): Promise<void> { this.sources.set(row.source, row) }
  async readSeen(): Promise<TrendSeenRow[]> { return this.seen }
  async upsertSeen(rows: readonly TrendSeenRow[]): Promise<void> { this.seen.push(...rows) }
  async readPlanObservations(): Promise<PlanObservationRow[]> { return this.planObservations }
}

type FetchResult = Awaited<ReturnType<TrendSource['fetch']>>

function scripted(id: string, results: FetchResult[]): TrendSource {
  let index = 0
  return {
    id,
    async fetch() {
      const result = results[Math.min(index, results.length - 1)]!
      index += 1
      return result
    },
  }
}

const ok = (models: TrendModelRecord[], etag: string | null = null): FetchResult => ({ ok: true, notModified: false, etag, models, bytes: 1 })
const notModified = (etag: string | null = null): FetchResult => ({ ok: true, notModified: true, etag, bytes: 0 })
const failed: FetchResult = { ok: false, reason: 'http', httpStatus: 500 }

function section(store: FakeStore, id: TrendSection): TrendSectionPayload {
  return JSON.parse(store.sections.get(id)!.payload) as TrendSectionPayload
}

function seedObservations(store: FakeStore): void {
  store.planObservations = [
    observation(),
    observation({ plan: 'ollama-cloud', modelId: 'glm-5.3', displayName: 'glm-5.3', source: 'ollama-tags' }),
  ]
}

describe('Given the multi-source trend refresh', () => {
  it('When OpenRouter and Go are present Then writes both new-models and free-models', async () => {
    const store = new FakeStore()
    seedObservations(store)
    const result = await refreshTrendSections({
      store,
      nowMs: NOW,
      sources: [
        scripted(TREND_SOURCE_MODELS_DEV, [ok([model()], '"md"')]),
        scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([])]),
        scripted(TREND_SOURCE_OPENCODE_GO, [ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true, limitedTime: true })])]),
        scripted(TREND_SOURCE_OPENROUTER, [ok([orModel('inclusionai/ling-3.2-flash')])]),
      ],
    })
    expect(result.newModels).toMatchObject({ ok: true, written: true, count: 1 })
    expect(result.freeModels).toMatchObject({ ok: true, written: true, count: 1, stale: false })
    expect(section(store, 'new-models').items.map((item) => item.id)).toEqual(['inclusionai/ling-3.2-flash'])
    expect(section(store, 'new-models').items.every((item) => Array.isArray(item.registeredIn))).toBe(true)
    expect(section(store, 'free-models').items.map((item) => item.freeKind)).toEqual(['opencode-go'])
    expect(section(store, 'free-models').sources.map((source) => source.id)).toEqual(['go-models'])
  })

  it('When OpenRouter fails after a good run Then keeps previous OpenRouter items and still refreshes free-models', async () => {
    const store = new FakeStore()
    seedObservations(store)
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model()]), ok([model({ canonicalId: 'anthropic/claude-y', name: 'Claude Y' })])])
    const go = scripted(TREND_SOURCE_OPENCODE_GO, [
      ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true })]),
      ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true })]),
    ])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([orModel('inclusionai/ling-3.2-flash')]), failed])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, go, router] })
    const result = await refreshTrendSections({ store, nowMs: NOW + HOUR, sources: [modelsDev, go, router] })
    expect(result.sources.openrouter).toBe('stale')
    const newModels = section(store, 'new-models')
    expect(newModels.items.map((item) => item.id)).toEqual(['inclusionai/ling-3.2-flash'])
    expect(newModels.items.find((item) => item.id === 'inclusionai/ling-3.2-flash')?.registeredIn).toEqual(['openrouter'])
    expect(newModels.sources.find((source) => source.id === 'openrouter')?.status).toBe('stale')
    expect(section(store, 'free-models').items).toHaveLength(1)
  })

  it('When models.dev fails Then refreshes OpenRouter and still builds free-models from Go', async () => {
    const store = new FakeStore()
    seedObservations(store)
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model()]), failed])
    const go = scripted(TREND_SOURCE_OPENCODE_GO, [
      ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true })]),
      ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true })]),
    ])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([orModel('inclusionai/ling-3.2-flash')]), ok([orModel('baidu/ernie-5.5-flash-preview')])])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, go, router] })
    const result = await refreshTrendSections({ store, nowMs: NOW + HOUR, sources: [modelsDev, go, router] })
    expect(result.newModels).toMatchObject({ ok: true, written: true })
    const newModels = section(store, 'new-models')
    expect(newModels.items.map((item) => item.id)).toEqual(['baidu/ernie-5.5-flash-preview'])
    expect(newModels.sources.find((source) => source.id === 'models.dev')?.status).toBe('stale')
    expect(section(store, 'free-models').items.map((item) => item.id)).toEqual(['tencent/hy4-flash'])
    expect(section(store, 'free-models').sources.every((source) => source.status === 'ok')).toBe(true)
  })

  it('When all upstreams return 304 Then keeps new-models and free-models without rewriting', async () => {
    const store = new FakeStore()
    seedObservations(store)
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model()], '"md"'), notModified('"md"')])
    const go = scripted(TREND_SOURCE_OPENCODE_GO, [
      ok([model({ canonicalId: 'tencent/hy4-flash', provider: 'opencode-go', modelId: 'hy4-flash-free', name: 'Hy4 flash Free', price: { input: 0, output: 0 }, free: true })], '"go"'),
      notModified('"go"'),
    ])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([orModel('inclusionai/ling-3.2-flash')], '"o"'), notModified('"o"')])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, go, router] })
    const newBefore = section(store, 'new-models').items
    const freeBefore = section(store, 'free-models').items
    store.writes = []
    const result = await refreshTrendSections({ store, nowMs: NOW + HOUR, sources: [modelsDev, go, router] })
    expect(result.newModels).toMatchObject({ written: false, count: 1 })
    expect(result.freeModels).toMatchObject({ written: false, count: 1 })
    expect(store.writes).toEqual([])
    expect(section(store, 'new-models').items).toEqual(newBefore)
    expect(section(store, 'free-models').items).toEqual(freeBefore)
  })

  it('When 8 days pass and the upstreams return 304 Then drops out-of-window registrations', async () => {
    const store = new FakeStore()
    seedObservations(store)
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model()], '"md"'), notModified('"md"')])
    const zen = scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([]), notModified('"z"')])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([orModel('inclusionai/ling-3.2-flash')], '"o"'), notModified('"o"')])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, zen, router] })
    const result = await refreshTrendSections({ store, nowMs: NOW + 8 * DAY, sources: [modelsDev, zen, router] })
    expect(result.newModels).toMatchObject({ count: 0, written: true })
    expect(section(store, 'new-models').items).toEqual([])
  })

  it('When every upstream fails before any section exists Then creates neither section', async () => {
    const store = new FakeStore()
    const result = await refreshTrendSections({
      store,
      nowMs: NOW,
      sources: [
        scripted(TREND_SOURCE_MODELS_DEV, [failed]),
        scripted(TREND_SOURCE_OPENCODE_ZEN, [failed]),
        scripted(TREND_SOURCE_OPENROUTER, [failed]),
      ],
    })
    expect(result.newModels).toEqual({ ok: false, reason: 'source_failed' })
    expect(result.freeModels).toMatchObject({ ok: false, written: false, stale: true })
    expect(store.sections.has('new-models')).toBe(false)
    expect(store.sections.has('free-models')).toBe(false)
  })
})
