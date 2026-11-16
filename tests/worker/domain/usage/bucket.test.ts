import { describe, expect, it } from 'vitest'
import {
  BUCKET_MS,
  bucketStartMs,
  createBucketFoldState,
  foldBucketPage,
  isBucketPoint,
  mergeBucketSamples,
  truncateBucketSamples,
} from '../../../../worker/domain/usage/bucket'
import type { UsageHistorySample, UsageHistoryValue } from '../../../../shared/usage-history-contract'

const T0 = Date.parse('2026-11-16T00:00:00.000Z')

const value = (id: string, usedPercent: number, resetsAt: string | null = null): UsageHistoryValue => ({ id, usedPercent, resetsAt, cycleSeconds: null })

const sample = (id: string, atMs: number, values: UsageHistoryValue[] | null, overrides: Partial<UsageHistorySample> = {}): UsageHistorySample => ({
  id,
  runAt: new Date(atMs).toISOString(),
  status: values === null ? 'network_error' : 'ok',
  fetchedAt: new Date(atMs).toISOString(),
  intervalSec: 180,
  values,
  ...overrides,
})

const fold = (samples: UsageHistorySample[], previous: UsageHistorySample | null = null, fromMs = T0) => {
  const result = foldBucketPage(createBucketFoldState(previous), samples, { fromMs, untilMs: T0 + 30 * 86_400_000 })
  return { ...result, flatSamples: [...result.flats.values()] }
}

describe('Given the 900-second bucket grid', () => {
  it('When a timestamp is aligned Then it maps to the UTC bucket start', () => {
    expect(BUCKET_MS).toBe(900_000)
    expect(bucketStartMs(T0 + 899_999)).toBe(T0)
    expect(bucketStartMs(T0 + 900_000)).toBe(T0 + 900_000)
  })
})

describe('Given flat success samples in one bucket', () => {
  it('When values and reset are unchanged Then only the last flat representative remains', () => {
    const samples = [
      sample('1', T0 + 60_000, [value('five_hour', 10)]),
      sample('2', T0 + 120_000, [value('five_hour', 10)]),
      sample('3', T0 + 180_000, [value('five_hour', 10)]),
    ]
    const result = fold(samples)
    expect(result.points).toEqual([])
    expect(result.flatSamples.map(item => item.id)).toEqual(['3'])
    expect(result.flats.get(T0)?.runAt).toBe(samples[2]!.runAt)
  })
})

describe('Given a failure point', () => {
  it('When a failure sits inside a flat bucket Then the point is retained and does not absorb neighbouring success', () => {
    const samples = [
      sample('1', T0 + 60_000, [value('five_hour', 10)]),
      sample('2', T0 + 120_000, null, { status: 'rate_limited' }),
      sample('3', T0 + 180_000, [value('five_hour', 10)]),
    ]
    const result = fold(samples)
    expect(result.points.map(item => item.id)).toEqual(['2'])
    expect(result.flatSamples.map(item => item.id)).toEqual(['3'])
  })

  it('When an ok sample has no readable values Then it is a point and later success restarts the line', () => {
    const samples = [
      sample('1', T0 + 60_000, [value('five_hour', 10)]),
      sample('2', T0 + 120_000, null, { status: 'ok' }),
      sample('3', T0 + 180_000, [value('five_hour', 10)]),
    ]
    const result = fold(samples)
    expect(result.points.map(item => item.id)).toEqual(['2'])
    expect(result.flatSamples.map(item => item.id)).toEqual(['3'])
  })
})

describe('Given the boundary rules from ADR §7.1', () => {
  const previous = sample('1', T0, [value('five_hour', 10)])

  it('When the gap exceeds twice the interval Then it is a point', () => {
    const current = sample('2', T0 + 3 * 180_000, [value('five_hour', 10)])
    expect(isBucketPoint(previous, current)).toBe(true)
    expect(fold([current], previous).points.map(item => item.id)).toEqual(['2'])
  })

  it('When the interval is unknown Then a gap over 1,800 seconds is a point', () => {
    const unknown = sample('1', T0, [value('five_hour', 10)], { intervalSec: null })
    expect(isBucketPoint(unknown, sample('2', T0 + 1_801_000, [value('five_hour', 10)], { intervalSec: null }))).toBe(true)
    expect(isBucketPoint(unknown, sample('2', T0 + 1_800_000, [value('five_hour', 10)], { intervalSec: null }))).toBe(false)
  })

  it('When a reset time changes Then it is a point', () => {
    expect(isBucketPoint(previous, sample('2', T0 + 60_000, [value('five_hour', 10, '2026-11-16T05:00:00.000Z')]))).toBe(true)
  })

  it('When the series set changes or disappears Then it is a point', () => {
    expect(isBucketPoint(previous, sample('2', T0 + 60_000, [value('five_hour', 10), value('seven_day', 20)]))).toBe(true)
    expect(isBucketPoint(previous, sample('2', T0 + 60_000, []))).toBe(true)
    const two = sample('1', T0, [value('five_hour', 10), value('seven_day', 20)])
    expect(isBucketPoint(two, sample('2', T0 + 60_000, [value('five_hour', 10)]))).toBe(true)
  })

  it('When usedPercent changes Then it is a point', () => {
    expect(isBucketPoint(previous, sample('2', T0 + 60_000, [value('five_hour', 11)]))).toBe(true)
  })

  it('When the previous event is a failure Then the next success starts a fresh flat segment instead of another point', () => {
    const failed = sample('1', T0, null, { status: 'upstream_error' })
    expect(isBucketPoint(failed, sample('2', T0 + 60_000, [value('five_hour', 10)]))).toBe(false)
  })
})

describe('Given from/until edges', () => {
  it('When a flat representative is before from Then it seeds state but is not emitted', () => {
    const samples = [
      sample('1', T0 - 60_000, [value('five_hour', 10)]),
      sample('2', T0 + 60_000, [value('five_hour', 10)]),
      sample('3', T0 + 120_000, [value('five_hour', 10)]),
    ]
    const result = fold(samples, null, T0)
    expect(result.flatSamples.map(item => item.id)).toEqual(['3'])
    expect(result.points).toEqual([])
  })

  it('When the first in-range sample is a change Then the point is emitted and no out-of-range flat leaks', () => {
    const samples = [
      sample('1', T0 - 60_000, [value('five_hour', 10)]),
      sample('2', T0 + 60_000, [value('five_hour', 20)]),
    ]
    const result = fold(samples, null, T0)
    expect(result.points.map(item => item.id)).toEqual(['2'])
    expect(result.flatSamples).toEqual([])
  })
})

describe('Given the response point cap', () => {
  it('When the merged samples exceed 4,000 Then the newest 4,000 survive and complete is false', () => {
    const samples = Array.from({ length: 4_100 }, (_, index) => sample(String(index + 1), T0 + index * 60_000, null, { status: 'network_error' }))
    const result = truncateBucketSamples(samples)
    expect(result.complete).toBe(false)
    expect(result.samples).toHaveLength(4_000)
    expect(result.samples[0]?.id).toBe('101')
    expect(result.samples.at(-1)?.id).toBe('4100')
  })

  it('When the merged samples are below the cap Then complete is true', () => {
    expect(truncateBucketSamples([sample('1', T0, null)], 1)).toEqual({ samples: [sample('1', T0, null)], complete: true })
  })

  it('When points and flats share a bucket Then both survive the merge', () => {
    const flat = sample('3', T0 + 180_000, [value('five_hour', 10)])
    const point = sample('2', T0 + 120_000, null, { status: 'rate_limited' })
    const merged = mergeBucketSamples([point], new Map([[T0, flat]]))
    expect(merged.map(item => item.id)).toEqual(['2', '3'])
  })
})

describe('Given a high-density synthetic provider (10,000 events at 180 seconds)', () => {
  it('When mostly flat values are folded Then the boundary count is bucketed, not one point per event, and the fold stays within the local budget', () => {
    const events = Array.from({ length: 10_000 }, (_, index) => sample(String(index + 1), T0 + index * 180_000, [value('five_hour', 10)]))
    const started = Date.now()
    let state = createBucketFoldState(null)
    const points: UsageHistorySample[] = []
    const flats = new Map<number, UsageHistorySample>()
    for (let index = 0; index < events.length; index += 100) {
      const page = foldBucketPage(state, events.slice(index, index + 100), { fromMs: T0, untilMs: Number.POSITIVE_INFINITY })
      state = page.state
      points.push(...page.points)
      for (const [bucket, item] of page.flats) flats.set(bucket, item)
    }
    const elapsed = Date.now() - started
    const merged = mergeBucketSamples(points, flats)
    expect(merged.length).toBeLessThanOrEqual(2_100)
    expect(merged.length).toBeGreaterThan(1_900)
    expect(points).toEqual([])
    expect(elapsed).toBeLessThan(5_000)
  })
})
