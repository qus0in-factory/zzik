import { describe, expect, it } from 'vitest'
import {
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
} from '../../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { refreshTrendSections } from '../../../../worker/app/trend/refresh-trend'
import { buildNewModels } from '../../../../worker/domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource } from '../../../../worker/domain/trend/sources'
import type { TrendSectionRow, TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../../../worker/domain/trend/store'

const NOW = Date.UTC(2026, 10, 17, 0, 0, 0)
const DAY = 86_400_000

function model(overrides: Partial<TrendModelRecord> = {}): TrendModelRecord {
  return {
    canonicalId: 'anthropic/claude-x', provider: 'anthropic', modelId: 'claude-x',
    name: 'Claude X', creator: 'anthropic', releaseDate: '2026-11-16', releasePrecision: 'day',
    releaseMs: NOW - DAY, price: { input: 3, output: 15 }, free: false, openWeights: false, status: null, expiresAtMs: null,
    ...overrides,
  }
}

const hosted = (id: string, provider: string, overrides: Partial<TrendModelRecord> = {}) => model({
  canonicalId: id, provider, modelId: id, name: id, creator: id.split('/')[0] ?? provider,
  free: true, price: { input: 0, output: 0 }, ...overrides,
})
const local = (id: string, overrides: Partial<TrendModelRecord> = {}) => model({
  canonicalId: id, provider: 'ollama-cloud', modelId: id, name: id, creator: id.split('/')[0] ?? 'ollama-cloud',
  price: null, free: false, openWeights: true, ...overrides,
})

class FakeStore implements TrendStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  sources = new Map<string, TrendSourceStateRow>()
  seen: TrendSeenRow[] = []
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

describe('Given the multi-source trend refresh', () => {
  it('When every source returns 200 Then writes new-models and free-models and records each source state', async () => {
    const store = new FakeStore()
    const result = await refreshTrendSections({
      store,
      nowMs: NOW,
      sources: [
        scripted(TREND_SOURCE_MODELS_DEV, [ok([model(), local('qwen/qwen4-max')], '"md"')]),
        scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([hosted('tencent/hy4-flash', 'opencode')])]),
        scripted(TREND_SOURCE_OPENROUTER, [ok([hosted('inclusionai/ling-3.2-flash', 'openrouter')])]),
      ],
    })
    expect(result.newModels).toMatchObject({ ok: true, written: true, count: 2 })
    expect(result.freeModels).toMatchObject({ ok: true, written: true, count: 3, stale: false })
    expect(result.sources).toEqual({ 'models.dev': 'ok', 'opencode-zen': 'ok', openrouter: 'ok' })
    expect(section(store, 'new-models').items.map((item) => item.id).sort()).toEqual(['anthropic/claude-x', 'qwen/qwen4-max'])
    expect(section(store, 'free-models').items.map((item) => item.id).sort()).toEqual([
      'inclusionai/ling-3.2-flash', 'qwen/qwen4-max', 'tencent/hy4-flash',
    ])
    expect(store.sources.get(TREND_SOURCE_OPENCODE_ZEN)).toMatchObject({ ok: true, httpStatus: 200 })
  })

  it('When Zen fails after a good run Then keeps its items, marks only Zen stale, and still updates new-models', async () => {
    const store = new FakeStore()
    const zen = scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([hosted('tencent/hy4-flash', 'opencode')]), failed])
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model(), local('qwen/qwen4-max')]), ok([model({ canonicalId: 'anthropic/claude-y' }), local('qwen/qwen4-max')])])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([hosted('inclusionai/ling-3.2-flash', 'openrouter')])])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, zen, router] })
    const result = await refreshTrendSections({ store, nowMs: NOW + DAY, sources: [modelsDev, zen, router] })
    expect(result.sources).toMatchObject({ 'opencode-zen': 'stale', openrouter: 'ok', 'models.dev': 'ok' })
    expect(result.freeModels).toMatchObject({ stale: true, ok: false })
    const free = section(store, 'free-models')
    expect(free.items.map((item) => item.id).sort()).toContain('tencent/hy4-flash')
    expect(free.items.map((item) => item.id).sort()).toContain('qwen/qwen4-max')
    expect(free.sources.find((source) => source.id === TREND_SOURCE_OPENCODE_ZEN)?.status).toBe('stale')
    expect(section(store, 'new-models').items.map((item) => item.id).sort()).toEqual(['anthropic/claude-y', 'qwen/qwen4-max'])
  })

  it('When models.dev fails Then keeps local items and the new-models list, while hosted data still refreshes', async () => {
    const store = new FakeStore()
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model(), local('qwen/qwen4-max')]), failed])
    const zen = scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([hosted('tencent/hy4-flash', 'opencode')])])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([hosted('inclusionai/ling-3.2-flash', 'openrouter')]), ok([hosted('baidu/ernie-5.5-flash-preview', 'openrouter')])])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, zen, router] })
    const newBefore = section(store, 'new-models')
    const result = await refreshTrendSections({ store, nowMs: NOW + DAY, sources: [modelsDev, zen, router] })
    expect(result.newModels).toEqual({ ok: false, reason: 'source_failed' })
    expect(section(store, 'new-models').items).toEqual(newBefore.items)
    expect(section(store, 'new-models').sources[0]?.status).toBe('stale')
    const free = section(store, 'free-models')
    expect(free.items.map((item) => item.id)).toContain('qwen/qwen4-max')
    expect(free.items.map((item) => item.id)).toContain('baidu/ernie-5.5-flash-preview')
    expect(free.sources.find((source) => source.id === TREND_SOURCE_MODELS_DEV)?.status).toBe('stale')
  })

  it('When every source returns 304 Then keeps both sections and recovers stale source status', async () => {
    const store = new FakeStore()
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([model(), local('qwen/qwen4-max')], '"md"'), notModified('"md"')])
    const zen = scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([hosted('tencent/hy4-flash', 'opencode')], '"z"'), notModified('"z"')])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([hosted('inclusionai/ling-3.2-flash', 'openrouter')], '"o"'), notModified('"o"')])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, zen, router] })
    const before = section(store, 'free-models')
    store.writes = []
    const result = await refreshTrendSections({ store, nowMs: NOW + DAY, sources: [modelsDev, zen, router] })
    expect(result.freeModels).toMatchObject({ written: false, stale: false })
    expect(store.writes).toEqual([])
    expect(section(store, 'free-models').items).toEqual(before.items)
  })

  it('When a 304 arrives after the 30-day window expires Then drops only the expired local item', async () => {
    const store = new FakeStore()
    const modelsDev = scripted(TREND_SOURCE_MODELS_DEV, [ok([local('qwen/qwen4-max', { releaseMs: NOW - 29 * DAY })], '"md"'), notModified('"md"')])
    const zen = scripted(TREND_SOURCE_OPENCODE_ZEN, [ok([hosted('tencent/hy4-flash', 'opencode')], '"z"'), notModified('"z"')])
    const router = scripted(TREND_SOURCE_OPENROUTER, [ok([], '"o"'), notModified('"o"')])
    await refreshTrendSections({ store, nowMs: NOW, sources: [modelsDev, zen, router] })
    const result = await refreshTrendSections({ store, nowMs: NOW + 2 * DAY, sources: [modelsDev, zen, router] })
    expect(result.freeModels).toMatchObject({ count: 1, written: true })
    expect(section(store, 'free-models').items.map((item) => item.id)).toEqual(['tencent/hy4-flash'])
  })

  it('When every source fails before any section exists Then does not create an empty free-models section', async () => {
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
    expect(store.sections.has('free-models')).toBe(false)
  })
})
