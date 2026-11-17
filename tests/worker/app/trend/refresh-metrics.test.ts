import { describe, expect, it } from 'vitest'
import type { TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import { TREND_SOURCE_ARTIFICIAL_ANALYSIS, TREND_SOURCE_OPENROUTER_RANKINGS } from '../../../../shared/trend-contract'
import { refreshMetrics } from '../../../../worker/app/trend/refresh-metrics'
import { toAaRows } from '../../../../worker/domain/trend/metrics/aa'
import type {
  AaFetchResult,
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
  aa = new Map<string, ReturnType<typeof toAaRows>>()
  or: OrRankingRow[] = []
  writes: TrendSection[] = []
  pruned: [string, string] | null = null
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> { return this.sections.get(section) ?? null }
  async writeSection(payload: TrendSectionPayload): Promise<string> {
    this.writes.push(payload.section)
    this.sections.set(payload.section, { section: payload.section, payload: JSON.stringify(payload), payloadSha256: 'a'.repeat(64), generatedAt: Date.parse(payload.generatedAt) })
    return 'a'.repeat(64)
  }
  async readAaSnapshot(dayKey: string) { return this.aa.get(dayKey) ?? [] }
  async writeAaSnapshot(dayKey: string, rows: ReturnType<typeof toAaRows>) { this.aa.set(dayKey, rows) }
  async readOrRanking(fromDay: string, toDay: string) { return this.or.filter((row) => row.day >= fromDay && row.day <= toDay) }
  async writeOrRanking(rows: readonly OrRankingRow[]) { this.or = [...rows] }
  async prune(beforeAaDay: string, beforeOrDay: string) { this.pruned = [beforeAaDay, beforeOrDay] }
}

const aaOk = (entries: Array<[string, number]>, version = '3.0'): AaFetchResult => ({
  ok: true,
  snapshot: {
    version,
    entries: entries.map(([slug, intelligenceIndex]) => ({
      slug, name: slug, creator: slug.split('/')[0] ?? '', releaseDate: '2026-11-01',
      intelligenceIndex, priceIn: 1, priceOut: 2, domains: {},
    })),
  },
})
const aaFail = (reason: 'rate_limited' | 'unauthorized' | 'http'): AaFetchResult => ({ ok: false, reason, httpStatus: reason === 'rate_limited' ? 429 : 401 })
const orOk = (rows: OrRankingRow[], asOf = '2026-11-17T04:00:00Z'): OrFetchResult => ({ ok: true, snapshot: { asOf, rows } })
const orFail = (reason: 'unauthorized' | 'rate_limited'): OrFetchResult => ({ ok: false, reason, httpStatus: reason === 'unauthorized' ? 401 : 429 })

function aaSource(result: AaFetchResult): AaSource { return { id: TREND_SOURCE_ARTIFICIAL_ANALYSIS, async fetch() { return result } } }
function orSource(result: OrFetchResult): OrRankingSource { return { id: TREND_SOURCE_OPENROUTER_RANKINGS, async fetch() { return result } } }

const rows = (offset: number, permaslug: string, tokens: string): OrRankingRow => ({ day: day(offset), permaslug, totalTokens: tokens })

function metricsPayload(store: FakeMetricsStore) {
  return JSON.parse(store.sections.get('metrics')!.payload) as {
    section: string
    items: unknown[]
    sources: Array<{ id: string; status: string }>
    blocks: Array<{ id: string; status: string; note?: string; entries: Array<Record<string, unknown>>; attribution: string; version?: string }>
  }
}

describe('Given the daily metrics refresh', () => {
  it('When AA and OR succeed Then writes both blocks, snapshots and source states', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({
      store,
      nowMs: NOW,
      aaSource: aaSource(aaOk([['a/x', 90], ['b/x', 80]])),
      orSource: orSource(orOk([rows(0, 'a/x', '600'), rows(0, 'other', '400')])),
    })
    expect(result).toMatchObject({ ok: true, written: true, notConfigured: false, blocks: { aa: 'ok', or: 'ok' } })
    expect(store.aa.get(day(0))).toHaveLength(2)
    expect(store.or).toHaveLength(2)
    expect(store.pruned).toEqual([day(-90), day(-60)])
    const payload = metricsPayload(store)
    expect(payload.section).toBe('metrics')
    expect(payload.items).toEqual([])
    expect(payload.sources).toEqual([
      { id: TREND_SOURCE_ARTIFICIAL_ANALYSIS, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
      { id: TREND_SOURCE_OPENROUTER_RANKINGS, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
    ])
    expect(payload.blocks.find((block) => block.id === 'aa-intelligence')).toMatchObject({ status: 'ok', version: '3.0', note: 'baseline' })
    expect(payload.blocks.find((block) => block.id === 'or-usage')).toMatchObject({ status: 'ok', note: 'baseline' })
  })

  it('When a 7-day AA snapshot exists Then computes rank deltas and new entries', async () => {
    const store = new FakeMetricsStore()
    store.aa.set(day(-7), toAaRows({
      version: '3.0',
      entries: [
        { slug: 'b/x', name: 'b/x', creator: 'b', releaseDate: '2026-11-01', intelligenceIndex: 90, priceIn: 1, priceOut: 2, domains: {} },
        { slug: 'a/x', name: 'a/x', creator: 'a', releaseDate: '2026-11-01', intelligenceIndex: 80, priceIn: 1, priceOut: 2, domains: {} },
      ],
    }, day(-7)))
    const result = await refreshMetrics({
      store, nowMs: NOW,
      aaSource: aaSource(aaOk([['new/y', 99], ['a/x', 90], ['b/x', 80]])),
      orSource: null,
    })
    expect(result.blocks).toEqual({ aa: 'ok', or: 'not_configured' })
    const block = metricsPayload(store).blocks.find((entry) => entry.id === 'aa-intelligence')!
    expect(block.note).toBeUndefined()
    expect(block.entries[0]).toMatchObject({ id: 'new/y', rank: 1, rankDelta: null, kind: 'new-top' })
    expect(block.entries.find((entry) => entry.id === 'a/x')).toMatchObject({ rank: 2, rankDelta: 0 })
    expect(block.entries.find((entry) => entry.id === 'b/x')).toMatchObject({ rank: 3, rankDelta: -2 })
  })

  it('When AA is rate limited but OR succeeds Then keeps the previous AA block as stale and refreshes OR', async () => {
    const store = new FakeMetricsStore()
    await refreshMetrics({ store, nowMs: NOW, aaSource: aaSource(aaOk([['a/x', 90]])), orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    const before = metricsPayload(store).blocks.find((block) => block.id === 'aa-intelligence')!
    const result = await refreshMetrics({
      store, nowMs: NOW + DAY,
      aaSource: aaSource(aaFail('rate_limited')),
      orSource: orSource(orOk([rows(-1, 'b/x', '200'), rows(0, 'b/x', '300')])),
    })
    expect(result.reasons).toEqual({ aa: 'rate_limited', or: null })
    expect(result.blocks).toEqual({ aa: 'stale', or: 'ok' })
    const after = metricsPayload(store).blocks.find((block) => block.id === 'aa-intelligence')!
    expect(after.status).toBe('stale')
    expect(after.note).toBe('source_failed')
    expect(after.entries).toEqual(before.entries)
    expect(metricsPayload(store).blocks.find((block) => block.id === 'or-usage')?.entries[0]).toMatchObject({ id: 'b/x', rank: 1 })
  })

  it('When OR is unauthorized but AA succeeds Then keeps the previous OR block as stale', async () => {
    const store = new FakeMetricsStore()
    await refreshMetrics({ store, nowMs: NOW, aaSource: aaSource(aaOk([['a/x', 90]])), orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    const result = await refreshMetrics({
      store, nowMs: NOW + DAY,
      aaSource: aaSource(aaOk([['a/x', 91]])),
      orSource: orSource(orFail('unauthorized')),
    })
    expect(result.reasons).toEqual({ aa: null, or: 'unauthorized' })
    expect(result.blocks).toEqual({ aa: 'ok', or: 'stale' })
    const block = metricsPayload(store).blocks.find((entry) => entry.id === 'or-usage')!
    expect(block.status).toBe('stale')
    expect(block.entries[0]).toMatchObject({ id: 'a/x' })
  })

  it('When both secrets are absent Then skips the section and network entirely', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({ store, nowMs: NOW, aaSource: null, orSource: null })
    expect(result).toMatchObject({ ok: false, written: false, notConfigured: true, blocks: { aa: 'not_configured', or: 'not_configured' } })
    expect(store.writes).toEqual([])
    expect(store.sections.has('metrics')).toBe(false)
  })

  it('When the first run has one failed source Then still writes the healthy block and marks the other stale', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({ store, nowMs: NOW, aaSource: aaSource(aaFail('http')), orSource: orSource(orOk([rows(0, 'a/x', '100')])) })
    expect(result).toMatchObject({ ok: true, written: true, blocks: { aa: 'stale', or: 'ok' } })
    const payload = metricsPayload(store)
    expect(payload.blocks.find((block) => block.id === 'aa-intelligence')).toMatchObject({ status: 'stale', note: 'source_failed', entries: [] })
    expect(payload.sources).toEqual([
      { id: TREND_SOURCE_ARTIFICIAL_ANALYSIS, fetchedAt: new Date(NOW).toISOString(), status: 'stale' },
      { id: TREND_SOURCE_OPENROUTER_RANKINGS, fetchedAt: new Date(NOW).toISOString(), status: 'ok' },
    ])
  })

  it('When both configured sources fail before any section exists Then does not create an empty section', async () => {
    const store = new FakeMetricsStore()
    const result = await refreshMetrics({
      store, nowMs: NOW,
      aaSource: aaSource(aaFail('http')),
      orSource: orSource(orFail('rate_limited')),
    })
    expect(result).toMatchObject({ ok: false, written: false, notConfigured: false })
    expect(store.sections.has('metrics')).toBe(false)
  })

  it('When the same snapshots are fetched again Then does not rewrite the section', async () => {
    const store = new FakeMetricsStore()
    const aa = aaSource(aaOk([['a/x', 90]]))
    const or = orSource(orOk([rows(0, 'a/x', '100')]))
    await refreshMetrics({ store, nowMs: NOW, aaSource: aa, orSource: or })
    store.writes = []
    const result = await refreshMetrics({ store, nowMs: NOW + 3_600_000, aaSource: aa, orSource: or })
    expect(result).toMatchObject({ ok: true, written: false })
    expect(store.writes).toEqual([])
  })
})
