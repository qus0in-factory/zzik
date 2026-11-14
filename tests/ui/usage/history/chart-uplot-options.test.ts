import { describe, expect, it } from 'vitest'
import type uPlot from 'uplot'
import type { ChartView } from '@app/usage/history/chart-view'
import { CHART_MESSAGES, formatAxisTime } from '@app/usage/history/chart-messages'
import { ko } from '@shared/messages'
import { FALLBACK_PALETTE, toUplotData, toUplotOptions, toUplotSeries, xAxisValues } from '@ui/usage/history/chart-uplot-options'

const SERIES: ChartView['series'] = [
  { id: 'a', label: 'A', slot: 1, dash: null, hidden: false, paths: [], dots: [], endLabel: null },
  { id: 'b', label: 'B', slot: 4, dash: '6 3', hidden: false, paths: [], dots: [], endLabel: null },
  { id: 'c', label: 'C', slot: 8, dash: '10 3', hidden: true, paths: [], dots: [], endLabel: null },
  { id: 'd', label: 'D', slot: 0, dash: '4 4', hidden: false, paths: [], dots: [], endLabel: null },
]

const view: ChartView = {
  range: '7d', width: 640, height: 240,
  plot: { x: 34, y: 10, width: 560, height: 206 },
  title: 'T', description: 'D',
  xTicks: [], yTicks: [],
  series: SERIES,
  stops: [
    {
      t: 1_700_000_000_000, x: 34, label: '첫 시점', valueText: '첫 시점 — A 42%',
      values: [
        { seriesId: 'a', percent: 42, text: '42%', y: 120 },
        { seriesId: 'b', percent: null, text: '—', y: null },
        { seriesId: 'c', percent: 7, text: '7%', y: 190 },
        { seriesId: 'd', percent: 104, text: '104%', y: 10 },
      ],
    },
    {
      t: 1_700_000_900_000, x: 200, label: '둘째 시점', valueText: '둘째 시점 — A 50%',
      values: [
        { seriesId: 'a', percent: 50, text: '50%', y: 113 },
        { seriesId: 'b', percent: 30, text: '30%', y: 154 },
        { seriesId: 'c', percent: 8, text: '8%', y: 189 },
        { seriesId: 'd', percent: 12, text: '12%', y: 191 },
      ],
    },
  ],
  table: [], empty: 'none',
}

/** 현지 시간 정오·13시 — 어떤 시간대에서도 같은 날이다. */
function localNoonSeconds(): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0).getTime() / 1000
}
const callValues = (values: unknown, splits: number[]): string[] =>
  (values as (_self: unknown, splits: number[], axisIdx: number, space: number, incr: number) => string[])(null, splits, 0, 0, 0)

describe('Given the ChartView → uPlot adapter', () => {
  it('Then the x column is epoch seconds and hidden series are excluded', () => {
    const data = toUplotData(view)
    expect(data[0]).toEqual([1_700_000_000, 1_700_000_900])
    expect(data).toHaveLength(4)
  })

  it('Then gaps (null percent) stay null and over-100 values are kept as real values', () => {
    const data = toUplotData(view) as unknown as (number | null)[][]
    expect(data[2][0]).toBeNull()
    expect(data[3][0]).toBe(104)
    expect(data[1]).toEqual([42, 50])
  })

  it('Then slots 4~8 map to uPlot dash arrays and colours come from the CSS palette', () => {
    const series = toUplotSeries(view, FALLBACK_PALETTE)
    expect(series).toHaveLength(4)
    expect(series[1].dash).toBeUndefined()
    expect(series[2].dash).toEqual([6, 3])
    expect(series[3].dash).toEqual([4, 4])
    expect(series[1].stroke).toBe(FALLBACK_PALETTE.slots[1])
    expect(series[3].stroke).toBe(FALLBACK_PALETTE.slots[0])
  })

  it('Then y is pinned to 0~100, x is time and the duplicate uPlot legend is OFF', () => {
    const options = toUplotOptions(view, FALLBACK_PALETTE)
    expect(options.scales?.y?.range).toEqual([0, 100])
    expect(options.scales?.x?.time).toBe(true)
    expect(options.legend?.show).toBe(false)
    expect(options.series).toHaveLength(4)
    expect(options.width).toBe(640)
    expect(options.height).toBe(240)
  })

  it('Then the x axis uses a Korean values formatter from axes.values', () => {
    const options = toUplotOptions(view, FALLBACK_PALETTE)
    expect(typeof options.axes?.[0]?.values).toBe('function')
    const dayView: ChartView = { ...view, range: '30d' }
    expect(typeof toUplotOptions(dayView, FALLBACK_PALETTE).axes?.[0]?.values).toBe('function')
  })

  it('Then 7d/30d allow only day multiples (86400s) and 24h uses hour increments', () => {
    const day = toUplotOptions(view, FALLBACK_PALETTE) // range = '7d'
    const incrs = day.axes?.[0]?.incrs as number[]
    expect(Array.isArray(incrs)).toBe(true)
    expect(incrs.length).toBeGreaterThan(0)
    expect(incrs.every((incr) => incr > 0 && incr % 86_400 === 0)).toBe(true)
    expect(day.axes?.[0]?.space).toBe(60)
    const month = toUplotOptions({ ...view, range: '30d' }, FALLBACK_PALETTE)
    expect((month.axes?.[0]?.incrs as number[]).every((incr) => incr > 0 && incr % 86_400 === 0)).toBe(true)
    const hourIncrs = toUplotOptions({ ...view, range: '24h' }, FALLBACK_PALETTE).axes?.[0]?.incrs as number[]
    expect(hourIncrs).toContain(3_600)
    expect(hourIncrs.every((incr) => incr < 86_400)).toBe(true)
  })

  it('Then setCursor hook reports the nearest data index to our tooltip', () => {
    const seen: (number | null)[] = []
    const options = toUplotOptions(view, FALLBACK_PALETTE, (idx) => seen.push(idx))
    const hook = options.hooks?.setCursor
    const fn = Array.isArray(hook) ? hook[0] : hook
    fn?.({ cursor: { idx: 1 } } as unknown as uPlot)
    expect(seen).toEqual([1])
  })
})

describe('Given Korean axis and cursor messages', () => {
  it('Then the 24h x ticks are HH:mm and the first tick of a day shows the date boundary', () => {
    const noon = localNoonSeconds()
    const date = new Date(noon * 1000)
    const out = callValues(xAxisValues('24h'), [noon, noon + 3600])
    expect(out[0]).toBe(`${date.getMonth() + 1}/${date.getDate()} 12:00`)
    expect(out[1]).toBe('13:00')
    expect(out[1]).not.toContain('/')
  })

  it('Then 7d/30d x ticks are M/D dates', () => {
    const noon = localNoonSeconds()
    const date = new Date(noon * 1000)
    const expected = `${date.getMonth() + 1}/${date.getDate()}`
    expect(callValues(xAxisValues('7d'), [noon])).toEqual([expected])
    expect(callValues(xAxisValues('30d'), [noon])).toEqual([expected])
  })

  it('Then 7d tick labels never repeat a date (12시간 간격 눈금이 와도 하루 하나)', () => {
    const noon = localNoonSeconds()
    const halfDays = Array.from({ length: 9 }, (_, i) => noon + i * 43_200)
    const labels = callValues(xAxisValues('7d'), halfDays).filter((label) => label !== null)
    expect(labels.length).toBeGreaterThan(1)
    expect(new Set(labels).size).toBe(labels.length)
    // 하루 단위(86400초) 눈금은 날짜마다 하나씩, 모두 표시
    const daily = callValues(xAxisValues('7d'), Array.from({ length: 7 }, (_, i) => noon + i * 86_400))
    expect(daily.every((label) => label !== null)).toBe(true)
    expect(new Set(daily).size).toBe(7)
  })

  it('Then the cursor label is 시각 via shared/messages t(), not the English Time', () => {
    expect(ko['chart.cursor.time']).toBe('시각')
    expect(CHART_MESSAGES.cursorTime).toBe('시각')
    expect(formatAxisTime(localNoonSeconds())).toBe('12:00')
  })
})
