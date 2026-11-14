import { describe, expect, it } from 'vitest'
import {
  applyBackfill,
  applyForward,
  compareCursors,
  coverageOf,
  createRecord,
  HISTORY_RECORD_MAX_SAMPLES,
  isForwardStale,
  mergeSamples,
  pruneRecord,
  sampleCursor,
  validateRecord,
  withLabels,
  withSync,
} from '@domain/usage/history/record'
import type { UsageHistoryPage, UsageHistorySample } from '../../../../shared/usage-history-contract'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'

const NOW = '2026-11-14T12:00:00.000Z'
const sample = (id: number, runAt: string, values: { id: string; usedPercent: number }[] | null = [{ id: 'five_hour', usedPercent: id }], status: UsageHistorySample['status'] = 'ok'): UsageHistorySample => ({
  id: String(id),
  runAt,
  status,
  fetchedAt: runAt,
  intervalSec: 900,
  values: values === null ? null : values.map((value) => ({ ...value, resetsAt: null, cycleSeconds: null })),
})
const page = (samples: UsageHistorySample[], nextCursor: string | null, anchor: UsageHistorySample | null = null, hasMore = false): UsageHistoryPage => ({ provider: 'claude', scanVersion: USAGE_HISTORY_SCAN_VERSION, samples, anchor, nextCursor, hasMore })
const ctx = { provider: 'claude' as const, now: NOW, initialFrom: '2026-11-13T12:00:00.000Z' }

describe('Given cursors and merging', () => {
  it('Then the cursor is "<runAt>_<id>" and compares by (runAt, id numerically)', () => {
    expect(sampleCursor(sample(9, '2026-11-14T00:00:00.000Z'))).toBe('2026-11-14T00:00:00.000Z_9')
    expect(compareCursors('2026-11-14T00:00:00.000Z_9', '2026-11-14T00:00:00.000Z_10')).toBeLessThan(0)
    expect(compareCursors('2026-11-14T00:00:01.000Z_1', '2026-11-14T00:00:00.000Z_99')).toBeGreaterThan(0)
    expect(compareCursors('a_1', 'a_1')).toBe(0)
  })
  it('When the same page is merged twice Then the result is the same as once (멱등), sorted and unique by id', () => {
    const a = [sample(2, '2026-11-14T01:00:00.000Z'), sample(1, '2026-11-14T00:00:00.000Z')]
    const once = mergeSamples([], a)
    expect(once.map((s) => s.id)).toEqual(['1', '2'])
    expect(mergeSamples(once, a)).toEqual(once)
  })
  it('When two samples share a runAt Then the id breaks the tie', () => {
    const merged = mergeSamples([sample(11, '2026-11-14T00:00:00.000Z')], [sample(9, '2026-11-14T00:00:00.000Z')])
    expect(merged.map((s) => s.id)).toEqual(['9', '11'])
  })
})

describe('Given a forward commit (I1·I2·I3·I4)', () => {
  const first = page([sample(1, '2026-11-14T00:00:00.000Z'), sample(2, '2026-11-14T00:15:00.000Z')], '2026-11-14T00:15:00.000Z_2', sample(0, '2026-11-13T11:00:00.000Z'))
  it('When there is no record Then the first page creates it with coveredFrom and anchor in the same commit (I2)', () => {
    const record = applyForward(null, null, first, ctx)
    expect(record).toMatchObject({ v: 1, provider: 'claude', coveredFrom: ctx.initialFrom, cursor: '2026-11-14T00:15:00.000Z_2', scanVersion: USAGE_HISTORY_SCAN_VERSION })
    expect(record?.anchor?.id).toBe('0')
    expect(record?.samples.map((s) => s.id)).toEqual(['1', '2'])
    expect(record?.seriesOrder).toEqual(['five_hour'])
  })
  it('When the cursor would move backwards Then it stays (I3)', () => {
    const record = applyForward(null, null, first, ctx)!
    const older = page([sample(1, '2026-11-14T00:00:00.000Z')], '2026-11-14T00:00:00.000Z_1')
    expect(applyForward(record, coverageOf(record), older, ctx)?.cursor).toBe('2026-11-14T00:15:00.000Z_2')
  })
  it('When the expected coverage differs from the stored one Then null — nothing is written (I4)', () => {
    const record = applyForward(null, null, first, ctx)!
    expect(applyForward(record, { coveredFrom: record.coveredFrom, cursor: '2026-11-14T00:00:00.000Z_1' }, first, ctx)).toBeNull()
    expect(applyForward(record, null, first, ctx)).toBeNull() // 읽을 때는 레코드가 없었는데 지금은 있다
    expect(applyForward(null, coverageOf(record), first, ctx)).toBeNull() // 읽을 때는 있었는데 지금은 없다
  })
  it('When a page with no samples and no cursor arrives on an empty record Then the cursor stays null and coveredFrom is still set', () => {
    const record = applyForward(null, null, page([], null), ctx)
    expect(record).toMatchObject({ coveredFrom: ctx.initialFrom, cursor: null, samples: [] })
  })
  it('Then seriesOrder only grows, in first-appearance order', () => {
    let record = applyForward(null, null, page([sample(1, '2026-11-14T00:00:00.000Z', [{ id: 'a', usedPercent: 1 }, { id: 'b', usedPercent: 2 }])], '2026-11-14T00:00:00.000Z_1'), ctx)!
    record = applyForward(record, coverageOf(record), page([sample(2, '2026-11-14T00:15:00.000Z', [{ id: 'c', usedPercent: 3 }, { id: 'a', usedPercent: 1 }])], '2026-11-14T00:15:00.000Z_2'), ctx)!
    expect(record.seriesOrder).toEqual(['a', 'b', 'c'])
  })
})

describe('Given a backfill commit', () => {
  const base = () => applyForward(null, null, page([sample(5, '2026-11-14T00:00:00.000Z')], '2026-11-14T00:00:00.000Z_5', sample(4, '2026-11-13T10:00:00.000Z')), ctx)!
  it('When a past chunk is committed Then coveredFrom moves earlier, the anchor is replaced and the cursor is untouched (I2)', () => {
    const record = base()
    const chunk = { from: '2026-11-12T12:00:00.000Z', samples: [sample(3, '2026-11-13T00:00:00.000Z')], anchor: sample(2, '2026-11-12T11:00:00.000Z') }
    const next = applyBackfill(record, coverageOf(record), chunk, ctx)!
    expect(next.coveredFrom).toBe('2026-11-12T12:00:00.000Z')
    expect(next.anchor?.id).toBe('2')
    expect(next.cursor).toBe(record.cursor)
    expect(next.samples.map((s) => s.id)).toEqual(['3', '5'])
  })
  it('When the chunk starts later than coveredFrom Then it never moves coveredFrom forward', () => {
    const record = base()
    const next = applyBackfill(record, coverageOf(record), { from: '2026-11-14T00:00:00.000Z', samples: [], anchor: null }, ctx)!
    expect(next.coveredFrom).toBe(ctx.initialFrom)
  })
  it('When there is no record or the expected coverage is stale Then null (I4)', () => {
    const record = base()
    expect(applyBackfill(null, null, { from: '2026-11-12T00:00:00.000Z', samples: [], anchor: null }, ctx)).toBeNull()
    expect(applyBackfill(record, { coveredFrom: 'x', cursor: record.cursor }, { from: '2026-11-12T00:00:00.000Z', samples: [], anchor: null }, ctx)).toBeNull()
  })
})

describe('Given validation, pruning, bookkeeping', () => {
  it('When v or scanVersion differs Then the whole record is discarded (I6)', () => {
    const record = createRecord('claude', NOW)
    expect(validateRecord(record, 'claude')).toEqual(record)
    expect(validateRecord({ ...record, v: 2 }, 'claude')).toBeNull()
    expect(validateRecord({ ...record, scanVersion: USAGE_HISTORY_SCAN_VERSION + 1 }, 'claude')).toBeNull()
    expect(validateRecord({ ...record, provider: 'codex' }, 'claude')).toBeNull()
    expect(validateRecord({ ...record, samples: 'x' }, 'claude')).toBeNull()
    expect(validateRecord(null, 'claude')).toBeNull()
  })
  it('When samples are older than 31 days Then they are pruned and coveredFrom/anchor follow', () => {
    const old = sample(1, '2026-10-01T00:00:00.000Z')
    const fresh = sample(2, '2026-11-13T00:00:00.000Z')
    const record = { ...createRecord('claude', NOW), coveredFrom: '2026-10-01T00:00:00.000Z', cursor: sampleCursor(fresh), samples: [old, fresh], seriesOrder: ['five_hour'] }
    const pruned = pruneRecord(record, Date.parse(NOW))
    expect(pruned.samples.map((s) => s.id)).toEqual(['2'])
    expect(pruned.anchor?.id).toBe('1')
    expect(Date.parse(pruned.coveredFrom ?? '')).toBeGreaterThanOrEqual(Date.parse(NOW) - 31 * 86_400_000)
  })
  it('When there are more than 4,000 samples Then only the newest 4,000 stay', () => {
    const many = Array.from({ length: HISTORY_RECORD_MAX_SAMPLES + 5 }, (_unused, index) => sample(index + 1, new Date(Date.parse('2026-11-13T00:00:00.000Z') + index * 1000).toISOString()))
    const record = { ...createRecord('claude', NOW), coveredFrom: many[0].runAt, cursor: sampleCursor(many.at(-1)!), samples: many }
    const pruned = pruneRecord(record, Date.parse(NOW))
    expect(pruned.samples).toHaveLength(HISTORY_RECORD_MAX_SAMPLES)
    expect(pruned.samples[0].id).toBe('6')
  })
  it('Then labels and sync bookkeeping are updated without touching samples', () => {
    const record = createRecord('claude', NOW)
    expect(withLabels(record, { five_hour: '5시간 한도' }).labels).toEqual({ five_hour: '5시간 한도' })
    expect(withLabels(record, {})).toBe(record)
    const synced = withSync(record, '2026-11-14T11:45:00.000Z', NOW)
    expect(synced).toMatchObject({ syncedThroughRunAt: '2026-11-14T11:45:00.000Z', syncedAt: NOW })
  })
  it('When the cursor is older than 30 days Then the forward sync treats the record as stale', () => {
    const fresh = { ...createRecord('claude', NOW), cursor: '2026-11-10T00:00:00.000Z_5' }
    const stale = { ...createRecord('claude', NOW), cursor: '2026-10-01T00:00:00.000Z_5' }
    expect(isForwardStale(fresh, Date.parse(NOW))).toBe(false)
    expect(isForwardStale(stale, Date.parse(NOW))).toBe(true)
    expect(isForwardStale({ ...createRecord('claude', NOW), cursor: null }, Date.parse(NOW))).toBe(false)
  })
})
