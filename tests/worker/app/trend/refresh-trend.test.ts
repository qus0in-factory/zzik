import { describe, expect, it } from 'vitest'
import { TREND_SOURCE_MODELS_DEV } from '../../../../shared/trend-contract'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { refreshTrend } from '../../../../worker/app/trend/refresh-trend'
import { buildNewModels } from '../../../../worker/domain/trend/sections/new-models'
import type { TrendModelRecord, TrendSource } from '../../../../worker/domain/trend/sources'
import type { TrendSectionRow, TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../../../worker/domain/trend/store'

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
  seen: TrendSeenRow[] = []
  sectionWrites = 0
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async readSections(): Promise<TrendSectionRow[]> { return [...this.sections.values()] }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.sectionWrites += 1
    const text = JSON.stringify(payload)
    this.sections.set(payload.section, { section: payload.section, payload: text, payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readSourceState(source: string): Promise<TrendSourceStateRow | null> { return this.sources.get(source) ?? null }
  async writeSourceState(row: TrendSourceStateRow): Promise<void> { this.sources.set(row.source, row) }
  async readSeen(): Promise<TrendSeenRow[]> { return this.seen }
  async upsertSeen(rows: readonly TrendSeenRow[]): Promise<void> { this.seen.push(...rows) }
}

function source(result: Awaited<ReturnType<TrendSource['fetch']>>): TrendSource {
  return { id: TREND_SOURCE_MODELS_DEV, async fetch() { return result } }
}

describe('Given trend refresh from models.dev', () => {
  it('When a 200 response arrives Then writes the section, seen row and source etag', async () => {
    const store = new FakeStore()
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v1"', models: [model], bytes: 1 }), nowMs: NOW })
    expect(result).toMatchObject({ ok: true, skipped: false, written: true, count: 1 })
    expect(store.sections.get('new-models')?.payload).toContain('anthropic/claude-x')
    expect(store.seen).toEqual([{ canonicalId: 'anthropic/claude-x', firstSeenAt: NOW, releaseDate: '2026-11-16', source: TREND_SOURCE_MODELS_DEV }])
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ etag: '"v1"', ok: true, httpStatus: 200 })
  })

  it('When the ETag returns 304 Then skips section write and records the conditional source state', async () => {
    const store = new FakeStore()
    store.sources.set(TREND_SOURCE_MODELS_DEV, { source: TREND_SOURCE_MODELS_DEV, etag: '"v1"', fetchedAt: NOW - 1000, ok: true, httpStatus: 200 })
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: true, etag: '"v1"', bytes: 0 }), nowMs: NOW })
    expect(result).toMatchObject({ ok: true, skipped: true, written: false })
    expect(store.sectionWrites).toBe(0)
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ etag: '"v1"', httpStatus: 304 })
  })

  it('When the source fails and a section exists Then keeps items and marks the source stale', async () => {
    const store = new FakeStore()
    const payload = buildNewModels([model], new Map(), NOW - 1000)
    await store.writeSection(payload)
    const result = await refreshTrend({ store, source: source({ ok: false, reason: 'http', httpStatus: 500 }), nowMs: NOW })
    expect(result).toEqual({ ok: false, reason: 'source_failed' })
    const stale = JSON.parse(store.sections.get('new-models')!.payload) as TrendSectionPayload
    expect(stale.items).toEqual(payload.items)
    expect(stale.sources.find((item) => item.id === TREND_SOURCE_MODELS_DEV)?.status).toBe('stale')
    expect(store.sources.get(TREND_SOURCE_MODELS_DEV)).toMatchObject({ ok: false, httpStatus: 500 })
  })

  it('When the same content is fetched again Then does not rewrite the section payload', async () => {
    const store = new FakeStore()
    const seen = new Map([['anthropic/claude-x', NOW - 86_400_000]])
    const existing = buildNewModels([model], seen, NOW - 3_600_000)
    await store.writeSection(existing)
    store.sectionWrites = 0
    store.seen = [{ canonicalId: 'anthropic/claude-x', firstSeenAt: NOW - 86_400_000, releaseDate: '2026-11-16', source: TREND_SOURCE_MODELS_DEV }]
    const result = await refreshTrend({ store, source: source({ ok: true, notModified: false, etag: '"v2"', models: [model], bytes: 1 }), nowMs: NOW })
    expect(result).toMatchObject({ ok: true, written: false })
    expect(store.sectionWrites).toBe(0)
    expect(store.seen).toHaveLength(1)
  })
})
