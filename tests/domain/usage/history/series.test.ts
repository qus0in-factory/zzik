import { describe, expect, it } from 'vitest'
import { buildSeries, C2_EARLY_RESET_ENABLED } from '@domain/usage/history/series'
import type { UsageHistorySample, UsageHistoryValue } from '../../../../shared/usage-history-contract'

const T0 = Date.parse('2026-11-14T00:00:00.000Z')
const MIN = 60_000
const at = (minutes: number): string => new Date(T0 + minutes * MIN).toISOString()
const val = (id: string, usedPercent: number, resetsAt: number | null = null, cycleSeconds: number | null = null): UsageHistoryValue => ({ id, usedPercent, resetsAt: resetsAt === null ? null : at(resetsAt), cycleSeconds })
let counter = 0
const ok = (minutes: number, values: UsageHistoryValue[] | null, intervalSec: number | null = 900): UsageHistorySample => ({ id: String(++counter), runAt: at(minutes), status: 'ok', fetchedAt: at(minutes), intervalSec, values })
const fail = (runMinutes: number, fetchedMinutes: number | null): UsageHistorySample => ({ id: String(++counter), runAt: at(runMinutes), status: 'upstream_error', fetchedAt: fetchedMinutes === null ? null : at(fetchedMinutes), intervalSec: 900, values: null })
const only = (id: string, input: Parameters<typeof buildSeries>[0]) => buildSeries(input).find((series) => series.id === id)
const shape = (id: string, input: Parameters<typeof buildSeries>[0]) => only(id, input)?.segments.map((segment) => segment.points.map((point) => [(point.t - T0) / MIN, point.p]))

describe('Given the series builder (ADR 0.7 5.3)', () => {
  it('When values are continuous Then one segment, and equal consecutive points keep only the first and last', () => {
    const samples = [ok(0, [val('a', 10)]), ok(15, [val('a', 10)]), ok(30, [val('a', 10)]), ok(45, [val('a', 20)])]
    expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10], [30, 10], [45, 20]]])
  })

  describe('C1 만료 리셋', () => {
    it('When the value drops after the reset time Then the first segment is extended flat to the reset and a new one starts', () => {
      const samples = [ok(0, [val('a', 80, 20)]), ok(10, [val('a', 90, 20)]), ok(60, [val('a', 5, 320)])]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([
        [[0, 80], [10, 90], [20, 90]],
        [[60, 5]],
      ])
    })
    it('When the next point arrives right after the reset the extension stops one interval before it (min(r, t − iv))', () => {
      const samples = [ok(0, [val('a', 80, 29)]), ok(30, [val('a', 5, 329)])]
      expect(shape('a', { anchor: null, samples, tailEnd: null })?.[0].at(-1)).toEqual([15, 80]) // min(r=29, t−iv=30−15)
      const tight = [ok(0, [val('a', 80, 29)]), ok(35, [val('a', 5, 329)], 300)]
      expect(shape('a', { anchor: null, samples: tight, tailEnd: null })?.[0].at(-1)).toEqual([29, 80])
    })
    it('When the value stays or rises after the reset time Then the line is not broken', () => {
      const samples = [ok(0, [val('a', 40, 10)]), ok(30, [val('a', 40, 20)]), ok(45, [val('a', 50, 30)])]
      expect(only('a', { anchor: null, samples, tailEnd: null })?.segments).toHaveLength(1)
    })
    it('When the reset time is null Then C1 never applies and a falling value is a straight line', () => {
      const samples = [ok(0, [val('extra', 40)]), ok(30, [val('extra', 10)])]
      expect(only('extra', { anchor: null, samples, tailEnd: null })?.segments).toHaveLength(1)
    })
  })

  describe('C2 조기 리셋', () => {
    it('Then it is off by default (G0-B3 전)', () => expect(C2_EARLY_RESET_ENABLED).toBe(false))
    it('When the cycle is unknown Then it is never applied even if enabled', () => {
      const samples = [ok(0, [val('a', 80, 1000, null)]), ok(30, [val('a', 5, 6000, null)])]
      expect(buildSeries({ anchor: null, samples, tailEnd: null }, { c2Enabled: true })[0].segments).toHaveLength(1)
    })
    it('When enabled with a known cycle and the reset time jumps with a lower value Then it breaks', () => {
      const samples = [ok(0, [val('a', 80, 1000, 18000)]), ok(30, [val('a', 5, 6000, 18000)])]
      expect(buildSeries({ anchor: null, samples, tailEnd: null }, { c2Enabled: true })[0].segments).toHaveLength(2)
    })
  })

  describe('C3 계열 소멸', () => {
    it('When a sample lacks one series Then only that series is closed one interval before the sample', () => {
      const samples = [ok(0, [val('a', 10), val('b', 20)]), ok(60, [val('a', 11)])]
      expect(shape('b', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 20], [45, 20]]])
      expect(only('a', { anchor: null, samples, tailEnd: null })?.segments).toHaveLength(1)
    })
    it('When values is [] Then every series is closed; the later reappearance starts a new segment', () => {
      const samples = [ok(0, [val('a', 10)]), ok(60, []), ok(75, [val('a', 12)])]
      expect(only('a', { anchor: null, samples, tailEnd: null })?.segments).toHaveLength(2)
    })
  })

  describe('C4 값 모름', () => {
    it('When a failure sample follows Then the series stops at its fetchedAt, not at runAt', () => {
      const samples = [ok(0, [val('a', 10)]), fail(30, 15)]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10], [15, 10]]])
    })
    it('When the failure fetchedAt is null Then the line is not extended', () => {
      const samples = [ok(0, [val('a', 10)]), fail(30, null)]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10]]])
    })
    it('When an ok sample could not be read (values null) Then it stops one interval before it — unlike [] which is "no series"', () => {
      const samples = [ok(0, [val('a', 10)]), ok(60, null)]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10], [45, 10]]])
    })
    it('When a failure sample comes before any point Then nothing is drawn for it', () => {
      expect(buildSeries({ anchor: null, samples: [fail(0, null)], tailEnd: null })).toEqual([])
    })
  })

  describe('이벤트가 없는 공백', () => {
    it('When two points are more than 1.5 intervals apart Then a hold point is inserted one interval before the next', () => {
      const samples = [ok(0, [val('a', 10)]), ok(120, [val('a', 30)])]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10], [105, 10], [120, 30]]])
    })
    it('When the gap is within 1.5 intervals Then no hold point', () => {
      const samples = [ok(0, [val('a', 10)]), ok(20, [val('a', 30)])]
      expect(shape('a', { anchor: null, samples, tailEnd: null })).toEqual([[[0, 10], [20, 30]]])
    })
  })

  describe('꼬리와 기준 표본', () => {
    it('When the snapshot is newer Then the open segment extends to it', () => {
      const samples = [ok(0, [val('a', 10, null)])]
      expect(shape('a', { anchor: null, samples, tailEnd: T0 + 50 * MIN })).toEqual([[[0, 10], [50, 10]]])
    })
    it('When the series has a reset time before the snapshot Then the tail stops at the reset (min(snapshot, r))', () => {
      const samples = [ok(0, [val('a', 10, 20, 18000)])]
      expect(shape('a', { anchor: null, samples, tailEnd: T0 + 50 * MIN })).toEqual([[[0, 10], [20, 10]]])
    })
    it('When the snapshot is a failure state its fetchedAt (older tailEnd) is where the line stops', () => {
      const samples = [ok(0, [val('a', 10)]), ok(20, [val('a', 12)])]
      expect(shape('a', { anchor: null, samples, tailEnd: T0 + 20 * MIN })).toEqual([[[0, 10], [20, 12]]])
    })
    it('When there is an anchor sample Then the left edge is filled from it', () => {
      const anchor = ok(-600, [val('a', 33)])
      const samples = [ok(0, [val('a', 33)])]
      expect(shape('a', { anchor, samples, tailEnd: null })?.[0][0]).toEqual([-600, 33])
    })
    it('When there are no samples but an anchor Then a single point (a hold line to the tail)', () => {
      const anchor = ok(-600, [val('a', 33, 400, 18000)])
      expect(shape('a', { anchor, samples: [], tailEnd: T0 })).toEqual([[[-600, 33], [0, 33]]])
    })
  })

  it('Then series come in first-appearance order and the input is not mutated', () => {
    const samples = [ok(0, [val('b', 1), val('a', 2)]), ok(15, [val('c', 3)])]
    const frozen = structuredClone(samples)
    expect(buildSeries({ anchor: null, samples, tailEnd: null }).map((series) => series.id)).toEqual(['b', 'a', 'c'])
    expect(samples).toEqual(frozen)
  })
  it('Then values above 100 are kept as-is (clipping is a chart concern)', () => {
    expect(shape('a', { anchor: null, samples: [ok(0, [val('a', 104)])], tailEnd: null })).toEqual([[[0, 104]]])
  })
})
