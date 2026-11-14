import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { UsageHistoryPage } from '../../../../shared/usage-history-contract'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { ChartViewInput } from '@app/usage/history/chart-view-input'
import { buildChartView, chartAlignedData } from '@app/usage/history/chart-view'
import { FALLBACK_PALETTE, toUplotData, toUplotOptions, toUplotSeries } from '@ui/usage/history/chart-uplot-options'
import claudePage from '../../../fixtures/usage-history/claude.samples.json'

const page = claudePage as unknown as UsageHistoryPage
const NOW = Date.parse('2026-11-14T00:30:00.000Z')
const DAY = 86_400_000
const sec = (iso: string): number => Date.parse(iso) / 1000

const record: HistoryCacheRecord = {
  v: 1,
  scanVersion: 1,
  provider: 'claude',
  coveredFrom: page.anchor?.fetchedAt ?? null,
  cursor: page.nextCursor,
  anchor: page.anchor,
  samples: page.samples,
  labels: { five_hour: '5시간 한도', seven_day: '주간 한도', extra_usage: '추가 사용량' },
  seriesOrder: ['five_hour', 'seven_day', 'extra_usage'],
  syncedThroughRunAt: null,
  syncedAt: '2026-11-14T00:30:00.000Z',
}

const input = (overrides: Partial<ChartViewInput> = {}): ChartViewInput => ({
  provider: 'claude',
  providerTitle: 'Claude',
  record,
  tailEnd: NOW,
  range: '24h',
  hidden: [],
  shown: [],
  cardLabels: {},
  size: { width: 640, height: 240 },
  nowMs: NOW,
  ...overrides,
})

function fiveHourColumn(): { times: number[]; column: (number | null)[] } {
  const view = buildChartView(input())
  const data = toUplotData(view) as unknown as (number | null)[][]
  return { times: data[0] as number[], column: data[1] }
}
const indexOf = (times: number[], t: number): number => times.indexOf(t)
const hasNullBetween = (times: number[], column: (number | null)[], a: number, b: number): boolean =>
  column.slice(indexOf(times, a) + 1, indexOf(times, b)).some((value) => value === null)

describe('Given the review reproduction (claude.samples.json five_hour)', () => {
  it('Then the aligned uPlot column is not the connected [92, 3, 9, 14, 14] — reset and failure gaps are null slots', () => {
    const { times, column } = fiveHourColumn()
    const t2300 = sec('2026-11-13T23:00:00.000Z')
    const t2315 = sec('2026-11-13T23:15:00.000Z')
    const t2345 = sec('2026-11-13T23:45:00.000Z')
    expect(column[indexOf(times, t2300)]).toBe(92)
    expect(column[indexOf(times, t2315)]).toBe(3)
    expect(column[indexOf(times, t2345)]).toBe(9)
    // C1 만료 리셋(92→3)과 C4 실패(3→9) 사이에 null 슬롯이 있어 uPlot이 선을 끊는다
    expect(hasNullBetween(times, column, t2300, t2315)).toBe(true)
    expect(hasNullBetween(times, column, t2315, t2345)).toBe(true)
    expect(column.some((value) => value === null)).toBe(true)
    expect(column).not.toEqual([92, 3, 9, 14, 14])
  })

  it('Then a single-point segment (23:15, 3%) is drawn as a point, not lost', () => {
    const view = buildChartView(input())
    const aligned = chartAlignedData(view)
    expect(aligned).not.toBeNull()
    expect(aligned!.dots[0].length).toBeGreaterThan(0)
    const series = toUplotSeries(view, FALLBACK_PALETTE)
    expect(series[1].points?.show).toBe(true)
    expect((series[1].points?.filter as number[]).length).toBeGreaterThan(0)
    expect(series[1].points?.size).toBe(4) // 반지름 2px
  })

  it('Then the anchor sample is included at the left boundary (its own time, or clamped to from when it precedes the range)', () => {
    const aligned = chartAlignedData(buildChartView(input()))!
    expect(aligned.times[0]).toBe((NOW - DAY) / 1000)
    const anchorSec = sec('2026-11-13T22:45:00.000Z')
    expect(aligned.times).toContain(anchorSec)
    expect(aligned.columns[0][aligned.times.indexOf(anchorSec)]).toBe(88)
    // anchor가 from보다 앞서는 범위에서는 from으로 옮겨 왼쪽 끝을 채운다
    const shifted = chartAlignedData(buildChartView(input({ nowMs: NOW + DAY })))!
    expect(shifted.times[0]).toBe(NOW / 1000)
    expect(shifted.columns[0][0]).toBe(88)
  })

  it('Then scales.x is pinned to the selected [from, to] window (B2)', () => {
    const view = buildChartView(input())
    const options = toUplotOptions(view, FALLBACK_PALETTE)
    expect(options.scales?.x?.range).toEqual([(NOW - DAY) / 1000, NOW / 1000])
    const month = buildChartView(input({ range: '30d' }))
    expect(toUplotOptions(month, FALLBACK_PALETTE).scales?.x?.range).toEqual([(NOW - 30 * DAY) / 1000, NOW / 1000])
  })

  it('Then the range input drives uPlot setCursor (N1)', () => {
    const source = readFileSync('src/ui/usage/history/HistoryChart.tsx', 'utf8')
    expect(source).toContain('plot.setCursor')
    expect(source).toContain('valToPos')
    expect(source).toContain('onRangeChange')
  })
})
