import { describe, expect, it } from 'vitest'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { TREND_SOURCE_ARTIFICIAL_ANALYSIS, TREND_SOURCE_OPENROUTER_RANKINGS } from '../../../../shared/trend-contract'
import { refreshMetrics } from '../../../../worker/app/trend/refresh-metrics'
import type {
  AaFetchResult,
  AaSnapshotRow,
  AaSource,
  MetricsStore,
  OrFetchResult,
  OrRankingRow,
  OrRankingSource,
} from '../../../../worker/domain/trend/metrics/types'
import type { TrendSectionRow } from '../../../../worker/domain/trend/store'

const NOW = Date.parse('2026-11-17T05:00:00.000Z')
const DAY = 86_400_000
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString().slice(0, 10)

class FakeMetricsStore implements MetricsStore {
  sections = new Map<TrendSection, TrendSectionRow>()
  or: OrRankingRow[] = []
  aa: AaSnapshotRow[] = []
  writes: TrendSection[] = []
  pruned: [string, string] | null = null
  failOrWrite = false
  failPrune = false
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.writes.push(payload.section)
    this.sections.set(payload.section, { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readAaSnapshot() { return this.aa }
  async writeAaSnapshot(_day: string, rows: readonly AaSnapshotRow[]) { this.aa = [...rows] }
  async readOrRanking(fromDay: string, toDay: string) { return this.or.filter((row) => row.day >= fromDay && row.day <= toDay) }
  async writeOrRanking(rows: readonly OrRankingRow[]) { if (this.failOrWrite) throw new Error('or storage failed'); this.or = [...rows] }
  async prune(beforeAaDay: string, beforeOrDay: string) { if (this.failPrune) throw new Error('prune failed'); this.pruned = [beforeAaDay, beforeOrDay] }
}

const orOk = (rows: OrRankingRow[], asOf = '2026-11-17T04:00:00Z'): OrFetchResult => ({ ok: true, snapshot: { asOf, asOfKind: 'source', meta: {}, rows } })
const orFail = (reason: 'unauthorized' | 'rate_limited'): OrFetchResult => ({ ok: false, reason, httpStatus: reason === 'unauthorized' ? 401 : 429 })
function orSource(result: OrFetchResult): OrRankingSource { return { id: TREND_SOURCE_OPENROUTER_RANKINGS, async fetch() { return result } } }
const aaEntry = (slug: string, name: string, index: number) => ({
  slug, name, creator: '', releaseDate: null, intelligenceIndex: index, priceIn: null, priceOut: null, domains: {},
})
const aaOk: AaFetchResult = {
  ok: true,
  snapshot: { version: '5', entries: [aaEntry('b', 'Model B', 80), aaEntry('a', 'Model A', 90), aaEntry('c', 'Model C', 70)] },
}
function aaSource(result: AaFetchResult): AaSource { return { id: TREND_SOURCE_ARTIFICIAL_ANALYSIS, async fetch() { return result } } }
const rows = (offset: number, permaslug: string, tokens: string): OrRankingRow => ({ day: day(offset), permaslug, totalTokens: tokens })

function metricsPayload(store: FakeMetricsStore) {
  return JSON.parse(store.sections.get('metrics')!.payload) as {
    section: string
    items: unknown[]
    sources: Array<{ id: string; status: string }>
    blocks: Array<{ id: string; status: string; note?: string; entries: Array<Record<string, unknown>>; attribution: string; version?: string }>
    aaCitation?: string
  }
}

describe('Given the daily metrics refresh (OpenRouter only)', () => {
  it('When OR succeeds Then writes only the OpenRouter block and source state', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({
      store, nowMs: NOW,
      orSource: orSource(orOk([rows(0, 'a/x', '600'), rows(0, 'other', '400')])),
    })
    expect(result).toMatchObject({ ok: true, written: true, notConfigured: false, blocks: { or: 'ok' } })
    expect(store.or).toHaveLength(2)
    expect(store.pruned).toEqual([day(-90), day(-60)])
    const payload = metricsPayload(store)
    expect(payload.section).toBe('metrics')
    expect(payload.items).toEqual([])
    expect(payload.sources).toEqual([{ id: TREND_SOURCE_OPENROUTER_RANKINGS, fetchedAt: new Date(NOW).toISOString(), status: 'ok' }])
    expect(payload.blocks.map((block) => block.id)).toEqual(['or-usage'])
    expect(payload.blocks[0]).toMatchObject({ status: 'ok', note: 'baseline' })
  })

  it('When OR is unauthorized after a good run Then keeps the previous OR block as stale', async () => {
    const store = new FakeMetricsStore()
    await refreshMetrics({ store, nowMs: NOW, orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    const result = await refreshMetrics({ store, nowMs: NOW + DAY, orSource: orSource(orFail('unauthorized')) })
    expect(result.reasons).toEqual({ or: 'unauthorized' })
    expect(result.blocks).toEqual({ or: 'stale' })
    const block = metricsPayload(store).blocks[0]!
    expect(block).toMatchObject({ id: 'or-usage', status: 'stale', note: 'source_failed' })
    expect(block.entries[0]).toMatchObject({ id: 'a/x' })
  })

  it('When OR storage throws after a good run Then keeps the previous block as stale', async () => {
    const store = new FakeMetricsStore()
    await refreshMetrics({ store, nowMs: NOW, orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    store.failOrWrite = true
    const result = await refreshMetrics({ store, nowMs: NOW + DAY, orSource: orSource(orOk([rows(-7, 'b/x', '100')])) })
    expect(result).toMatchObject({ ok: false, written: true, blocks: { or: 'stale' } })
    expect(result.reasons).toEqual({ or: 'storage' })
    const block = metricsPayload(store).blocks[0]!
    expect(block.status).toBe('stale')
    expect(block.entries[0]).toMatchObject({ id: 'a/x' })
  })

  it('When OR is absent before any data exists Then skips the section', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({ store, nowMs: NOW, orSource: null })
    expect(result).toMatchObject({ ok: false, written: false, notConfigured: true, blocks: { or: 'not_configured' } })
    expect(store.writes).toEqual([])
    expect(store.sections.has('metrics')).toBe(false)
  })

  it('When the key is removed after a good run Then rewrites the section with only a not_configured OR block', async () => {
    const store = new FakeMetricsStore()
    await refreshMetrics({ store, nowMs: NOW, orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    const result = await refreshMetrics({ store, nowMs: NOW + DAY, orSource: null })
    expect(result).toMatchObject({ ok: false, written: true, notConfigured: true, blocks: { or: 'not_configured' } })
    const payload = metricsPayload(store)
    expect(payload.sources).toEqual([])
    expect(payload.blocks.map((block) => [block.id, block.status])).toEqual([['or-usage', 'not_configured']])
  })

  it('When a previous payload still has an AA block Then the rewrite drops it from the public section', async () => {
    const store = new FakeMetricsStore()
    const previous: TrendSectionPayload = {
      section: 'metrics', schemaVersion: 1, generatedAt: new Date(NOW).toISOString(), rule: 'x',
      sources: [], items: [],
      blocks: [
        { id: 'aa-intelligence', status: 'ok', asOf: '2026-11-17', entries: [], attribution: 'AA' },
        { id: 'or-usage', status: 'ok', asOf: '2026-11-17T04:00:00Z', entries: [], attribution: 'OR' },
      ],
    }
    await store.writeSection(previous)
    await refreshMetrics({ store, nowMs: NOW + DAY, orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    expect(metricsPayload(store).blocks.map((block) => block.id)).toEqual(['or-usage'])
  })

  it('When prune fails Then the public section is still written', async () => {
    const store = new FakeMetricsStore()
    store.failPrune = true
    const result = await refreshMetrics({ store, nowMs: NOW, orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    expect(result).toMatchObject({ ok: true, written: true, blocks: { or: 'ok' } })
  })

  it('When the same snapshot is fetched again Then does not rewrite the section', async () => {
    const store = new FakeMetricsStore()
    const or = orSource(orOk([rows(0, 'a/x', '100')]))
    await refreshMetrics({ store, nowMs: NOW, orSource: or })
    store.writes = []
    const result = await refreshMetrics({ store, nowMs: NOW + 3_600_000, orSource: or })
    expect(result).toMatchObject({ ok: true, written: false })
    expect(store.writes).toEqual([])
  })

  it('When AA succeeds Then stores only its top two internally and exposes only one citation sentence', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({
      store, nowMs: NOW,
      orSource: orSource(orOk([rows(0, 'a/x', '100')])),
      aaSource: aaSource(aaOk),
    })
    expect(result.aa).toMatchObject({ status: 'ok' })
    expect(store.aa.map((row) => row.slug)).toEqual(['a', 'b', 'c'])
    const payload = metricsPayload(store)
    expect(payload.aaCitation).toBe('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')
    expect(payload.blocks.map((block) => block.id)).toEqual(['or-usage'])
    expect(JSON.stringify(payload)).not.toContain('"index"')
  })

  it('When AA succeeds with 55 entries Then stores top 50 internally and exposes only one citation sentence publicly', async () => {
    const store = new FakeMetricsStore()
    const entries = Array.from({ length: 55 }, (_, i) => ({
      slug: `model-${String(i + 1).padStart(2, '0')}`,
      name: `Model ${i + 1}`,
      creator: 'Org',
      releaseDate: '2026-11-10',
      intelligenceIndex: 99 - i,
      priceIn: 1,
      priceOut: 3,
      outputTokensPerSecond: 80,
      timeToFirstTokenSeconds: 0.9,
      domains: {},
    }))
    const result = await refreshMetrics({
      store,
      nowMs: NOW,
      orSource: orSource(orOk([rows(0, 'a/x', '100')])),
      aaSource: aaSource({ ok: true, snapshot: { version: '5.0', entries } }),
    })
    expect(result.aa).toMatchObject({ status: 'ok' })
    expect(store.aa).toHaveLength(50)
    expect(store.aa[0]?.slug).toBe('model-01')
    expect(store.aa[49]?.slug).toBe('model-50')
    const payload = metricsPayload(store)
    expect(payload.aaCitation).toBe('Artificial Analysis Intelligence Index 1위는 Model 1 (99)입니다. (2026-11-17 기준)')
    expect(JSON.stringify(payload)).not.toContain('model-02')
  })

  it('When AA succeeds but OR has no key on the first run Then the citation-only section is written', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({ store, nowMs: NOW, orSource: null, aaSource: aaSource(aaOk) })
    expect(result).toMatchObject({ ok: true, written: true, notConfigured: false })
    expect(result.aa).toMatchObject({ status: 'ok' })
    expect(store.writes).toEqual(['metrics'])
    const payload = metricsPayload(store)
    expect(payload.aaCitation).toBe('Artificial Analysis Intelligence Index 1위는 Model A (90)입니다. (2026-11-17 기준)')
  })

  it('When AA succeeds but OR fails on the first run Then the citation still creates the section', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({
      store, nowMs: NOW, orSource: orSource(orFail('unauthorized')), aaSource: aaSource(aaOk),
    })
    expect(result).toMatchObject({ ok: true, written: true, notConfigured: false })
    expect(metricsPayload(store).aaCitation).toContain('Model A')
  })

  it('When AA has no key or fails Then the citation is hidden', async () => {
    const store = new FakeMetricsStore()
    const withoutKey = await refreshMetrics({ store, nowMs: NOW, orSource: orSource(orOk([rows(0, 'a/x', '100')])), aaSource: null })
    expect(withoutKey.aa).toMatchObject({ status: 'not_configured' })
    expect(metricsPayload(store).aaCitation).toBeUndefined()

    const failed = await refreshMetrics({
      store, nowMs: NOW + DAY,
      orSource: orSource(orOk([rows(0, 'a/x', '100')])),
      aaSource: aaSource({ ok: false, reason: 'unauthorized', httpStatus: 401 }),
    })
    expect(failed.aa).toMatchObject({ status: 'stale' })
    expect(metricsPayload(store).aaCitation).toBeUndefined()
  })
})
