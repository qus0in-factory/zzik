import { describe, expect, it } from 'vitest'
import type { UsageHistoryPage, UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { ChartViewInput } from '@app/usage/history/chart-view-input'
import { buildChartView, nearestStopIndex } from '@app/usage/history/chart-view'
import claudePage from '../../../fixtures/usage-history/claude.samples.json'

const page = claudePage as unknown as UsageHistoryPage
const NOW = Date.parse('2026-11-14T00:30:00.000Z')
const LABELS: Record<string, string> = { five_hour: '5시간 한도', seven_day: '주간 한도', extra_usage: '추가 사용량' }
const ORDER = ['five_hour', 'seven_day', 'extra_usage']

function record(overrides: Partial<HistoryCacheRecord> = {}): HistoryCacheRecord {
  return {
    v: 1,
    scanVersion: 1,
    provider: 'claude',
    coveredFrom: page.anchor?.fetchedAt ?? null,
    cursor: page.nextCursor,
    anchor: page.anchor,
    samples: page.samples,
    labels: LABELS,
    seriesOrder: ORDER,
    syncedThroughRunAt: null,
    syncedAt: '2026-11-14T00:30:00.000Z',
    ...overrides,
  }
}

function input(overrides: Partial<ChartViewInput> = {}, rec: Partial<HistoryCacheRecord> = {}): ChartViewInput {
  return {
    provider: 'claude',
    providerTitle: 'Claude',
    record: record(rec),
    tailEnd: NOW,
    range: '24h',
    hidden: [],
    shown: [],
    cardLabels: LABELS,
    size: { width: 640, height: 240 },
    nowMs: NOW,
    ...overrides,
  }
}

describe('Given the Claude usage-history fixture through the T2 ChartViewInput', () => {
  it('Then the view carries the title, geometry and five x ticks', () => {
    const view = buildChartView(input())
    expect(view.title).toBe('Claude 사용률 추이 · 최근 24시간')
    expect(view.range).toBe('24h')
    expect(view.width).toBe(640)
    expect(view.height).toBe(240)
    expect(view.plot).toEqual({ x: 34, y: 10, width: 560, height: 206 })
    expect(view.yTicks.map((t) => t.label)).toEqual(['0%', '25%', '50%', '75%', '100%'])
    expect(view.xTicks).toHaveLength(5)
    expect(view.description).toContain('계열 3개 중 3개 표시')
  })

  it('Then slots 1~3 are solid, no SVG paths are built (uPlot draws) and gaps surface as null stop values', () => {
    const view = buildChartView(input())
    expect(view.series.map((s) => s.id)).toEqual(ORDER)
    expect(view.series.map((s) => s.slot)).toEqual([1, 2, 3])
    expect(view.series.map((s) => s.dash)).toEqual([null, null, null])
    expect(view.series.every((s) => s.paths.length === 0)).toBe(true)
    // 23:45 표본에서 extra_usage가 사라져(C3) 그 시점 값은 틈(null)이다 → uPlot data의 null 간격
    const gap = view.stops[2].values.find((v) => v.seriesId === 'extra_usage')
    expect(gap?.percent).toBeNull()
    expect(gap?.text).toBe('—')
  })

  it('Then stops are the sample times plus one tail, never thinned, with un-interpolated values', () => {
    const view = buildChartView(input())
    expect(view.stops).toHaveLength(5)
    expect(view.stops.map((s) => s.t)).toEqual([
      Date.parse('2026-11-13T23:00:00.000Z'),
      Date.parse('2026-11-13T23:15:00.000Z'),
      Date.parse('2026-11-13T23:45:00.000Z'),
      Date.parse('2026-11-14T00:00:00.000Z'),
      NOW,
    ])
    const afterReset = view.stops[1].values.find((v) => v.seriesId === 'five_hour')
    expect(afterReset?.percent).toBe(3)
    expect(afterReset?.text).toBe('3%')
    expect(view.stops[0].valueText).toContain('5시간 한도 92%')
  })

  it('Then hidden series keep their slot but leave the chart and the tooltip', () => {
    const view = buildChartView(input({ hidden: ['five_hour'] }))
    const hidden = view.series.find((s) => s.id === 'five_hour')
    expect(hidden?.hidden).toBe(true)
    expect(hidden?.slot).toBe(1)
    expect(hidden?.paths).toEqual([])
    expect(hidden?.endLabel).toBeNull()
    expect(view.stops[0].values.every((v) => v.seriesId !== 'five_hour')).toBe(true)
    expect(view.description).toContain('계열 3개 중 2개 표시')
  })

  it('Then hiding every series yields the all_hidden empty state', () => {
    expect(buildChartView(input({ hidden: ORDER })).empty).toBe('all_hidden')
  })

  it('Then the summary table has a row per series including hidden ones and counts resets', () => {
    const view = buildChartView(input({ hidden: ['seven_day'] }))
    expect(view.table).toHaveLength(3)
    expect(view.table.find((row) => row.id === 'five_hour')?.resets).toBeGreaterThanOrEqual(1)
  })

  it('Then a low-change two-sample record with no snapshot time keeps a flat tail up to now', () => {
    const sample = (id: string, iso: string): UsageHistorySample => ({
      id, runAt: iso, status: 'ok', fetchedAt: iso, intervalSec: 900,
      values: [{ id: 'included', usedPercent: 40, resetsAt: null, cycleSeconds: null }],
    })
    const samples = [sample('1', '2026-11-14T00:00:00.000Z'), sample('2', '2026-11-14T00:15:00.000Z')]
    const view = buildChartView(input({ tailEnd: null }, { samples, anchor: null, seriesOrder: ['included'], labels: { included: 'Included' } }))
    // 스냅샷 시각이 없어도 now(00:30)까지 마지막 값 40%가 유지된다
    expect(view.stops.at(-1)?.t).toBe(NOW)
    expect(view.stops.at(-1)?.values.find((v) => v.seriesId === 'included')?.percent).toBe(40)
    expect(view.series.find((s) => s.id === 'included')?.hidden).toBe(false)
  })

  it('Then nearestStopIndex snaps to the closest stop and -1 when there are none', () => {
    const view = buildChartView(input())
    expect(nearestStopIndex(view, view.stops[0].x)).toBe(0)
    expect(nearestStopIndex(view, view.stops[2].x)).toBe(2)
    expect(nearestStopIndex(view, -10000)).toBe(0)
    expect(nearestStopIndex(view, 100000)).toBe(view.stops.length - 1)
    expect(nearestStopIndex(buildChartView(input({}, { samples: [], anchor: null })), 100)).toBe(-1)
  })

  it('Then the ninth series falls to slot 0, is hidden by default and uses the overflow dash', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const sample: UsageHistorySample = {
      id: '1',
      runAt: '2026-11-14T00:00:00.000Z',
      status: 'ok',
      fetchedAt: '2026-11-14T00:00:00.000Z',
      intervalSec: 900,
      values: ids.map((id) => ({ id, usedPercent: 10, resetsAt: null, cycleSeconds: null })),
    }
    const view = buildChartView(input({}, { samples: [sample], anchor: null, seriesOrder: ids }))
    expect(view.series[3].dash).toBe('6 3')
    expect(view.series[7].dash).toBe('10 3')
    expect(view.series[8].slot).toBe(0)
    expect(view.series[8].dash).toBe('4 4')
    expect(view.series[8].hidden).toBe(true)
    expect(view.stops[0].values.every((v) => v.seriesId !== 'i')).toBe(true)
  })
})
