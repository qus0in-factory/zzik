import { describe, expect, it } from 'vitest'
import { TREND_SOURCE_MODELS_DEV } from '../../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { refreshTrend } from '../../../../worker/app/trend/refresh-trend'
import type { TrendModelRecord, TrendSource } from '../../../../worker/domain/trend/sources'
import type { TrendSectionRow, TrendSourceStateRow, TrendStore } from '../../../../worker/domain/trend/store'

const NOW = Date.UTC(2026, 10, 17, 0, 0, 0)
const model: TrendModelRecord = {
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
}

class FakeStore implements TrendStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  sources = new Map<string, TrendSourceStateRow>()
  sectionWrites = 0
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async readSections(): Promise<TrendSectionRow[]> { return [...this.sections.values()] }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.sectionWrites += 1
    this.sections.set(payload.section, { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readSourceState(source: string): Promise<TrendSourceStateRow | null> { return this.sources.get(source) ?? null }
  async writeSourceState(row: TrendSourceStateRow): Promise<void> { this.sources.set(row.source, row) }
  async readSeen(): Promise<never[]> { return [] }
  async upsertSeen(): Promise<void> {}
}

function source(result: Awaited<ReturnType<TrendSource['fetch']>>): TrendSource {
  return { id: TREND_SOURCE_MODELS_DEV, async fetch() { return result } }
}

function payload(store: FakeStore): TrendSectionPayload {
  return JSON.parse(store.sections.get('new-models')!.payload) as TrendSectionPayload
}

describe('Given trend refresh from models.dev (AA registration proxy)', () => {
  it('When a 200 response arrives Then writes the AA-badged section and source etag', async () => {
    const store = new FakeStore()
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    expect(result).toMatchObject({ ok: true, written: true, count: 1 })
    expect(payload(store).items[0]).toMatchObject({ id: 'anthropic/claude-x', registeredIn: ['aa'] })
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ etag: '"v1"', ok: true, httpStatus: 200 })
  })

  it('When the ETag returns 304 Then reuses the previous AA items without rewriting', async () => {
    const store = new FakeStore()
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    store.sectionWrites = 0
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: true, etag: '"v1"', bytes: 0 }), nowMs: NOW + 3_600_000 })
    expect(result).toMatchObject({ ok: true, written: false, count: 1 })
    expect(store.sectionWrites).toBe(0)
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ etag: '"v1"', httpStatus: 304 })
  })

  it('When the source fails and a section exists Then keeps the previous AA items and marks the source stale', async () => {
    const store = new FakeStore()
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    const before = payload(store)
    const result = await refreshTrend({ store, source: source({ ok: false, reason: 'http', httpStatus: 500 }), nowMs: NOW + 3_600_000 })
    expect(result).toMatchObject({ ok: true, written: true, count: 1 })
    const after = payload(store)
    expect(after.items).toEqual(before.items)
    expect(after.sources[0]?.status).toBe('stale')
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ ok: false, httpStatus: 500 })
  })

  it('When 8 days pass and a 304 arrives Then drops items outside the 7-day registration window', async () => {
    const store = new FakeStore()
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    store.sectionWrites = 0
    const later = NOW + 8 * 86_400_000
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: true, etag: '"v1"', bytes: 0 }), nowMs: later })
    expect(result).toMatchObject({ ok: true, written: true, count: 0 })
    expect(payload(store).items).toEqual([])
    expect(payload(store).generatedAt).toBe(new Date(later).toISOString())
  })

  it('When a structurally broken 200 arrives Then carries previous items and marks only the source stale', async () => {
    const store = new FakeStore()
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    const before = payload(store)
    const broken = await refreshTrend({ store, source: source({ ok: false, reason: 'invalid', httpStatus: null }), nowMs: NOW + 3_600_000 })
    expect(broken).toMatchObject({ ok: true, written: true })
    expect(payload(store).items).toEqual(before.items)
    expect(payload(store).sources[0]?.status).toBe('stale')
  })

  it('When a 200 arrives without an ETag Then stores null instead of the previous validator', async () => {
    const store = new FakeStore()
    store.sources.set(TREND_SOURCE_MODELS_DEV, { source: TREND_SOURCE_MODELS_DEV, etag: '"old"', fetchedAt: NOW - 1000, ok: true, httpStatus: 200 })
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: null, models: [model], bytes: 1 }), nowMs: NOW })
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ etag: null, httpStatus: 200 })
  })

  it('When failures repeat Then does not rewrite an already stale section', async () => {
    const store = new FakeStore()
    await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    await refreshTrend({ store, source: source({ ok: false, reason: 'http', httpStatus: 500 }), nowMs: NOW + 3_600_000 })
    const writes = store.sectionWrites
    await refreshTrend({ store, source: source({ ok: false, reason: 'http', httpStatus: 500 }), nowMs: NOW + 7_200_000 })
    expect(store.sectionWrites).toBe(writes)
  })
})
