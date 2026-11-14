/**
 * ChartView(동결 계약) → uPlot data/series/options 변환(순수).
 * 색은 CSS 변수에서 읽어 주입받는다 — 이 모듈은 DOM을 보지 않으므로 node에서 그대로 테스트된다.
 */
import type uPlot from 'uplot'
import type { ChartView } from '@app/usage/history/chart-view'

export interface ChartPalette {
  /** 슬롯 0~8 → CSS 변수에서 읽은 색 */
  slots: Record<number, string>
  grid: string
  axis: string
  text: string
}

/** CSS 변수를 못 읽는 환경(서버·테스트)용 기본값. 실제로는 readChartPalette()가 덮어쓴다. */
export const FALLBACK_PALETTE: ChartPalette = {
  slots: {
    0: '#888888', 1: '#2a78d6', 2: '#e0591f', 3: '#199e70', 4: '#b87a00',
    5: '#d55181', 6: '#008300', 7: '#6250d6', 8: '#e34948',
  },
  grid: '#e6e6e6',
  axis: '#c9c9c9',
  text: '#333333',
}

/** uPlot 시간축은 초 단위다. 결측·리셋으로 난 틈(percent null)은 그대로 null 간격이 된다. */
export function toUplotData(view: ChartView): uPlot.AlignedData {
  const visible = view.series.filter((series) => !series.hidden)
  const xs = view.stops.map((stop) => stop.t / 1000)
  const columns = visible.map((series) =>
    view.stops.map((stop) => stop.values.find((value) => value.seriesId === series.id)?.percent ?? null),
  )
  return [xs, ...columns] as uPlot.AlignedData
}

/** 슬롯 색·4~8번 파선·숨김 제외를 uPlot series 옵션으로 옮긴다(0번은 x축 자리). */
export function toUplotSeries(view: ChartView, palette: ChartPalette): uPlot.Series[] {
  const visible = view.series.filter((series) => !series.hidden)
  return [
    {},
    ...visible.map((series) => ({
      label: series.label,
      stroke: palette.slots[series.slot] ?? palette.slots[0],
      width: 2,
      dash: series.dash === null ? undefined : series.dash.split(' ').map(Number),
      spanGaps: false,
      points: { show: false },
    } satisfies uPlot.Series)),
  ]
}

/** y는 0~100 고정, x는 시간(초). 격자·축 색도 CSS 변수에서 온다. */
export function toUplotOptions(view: ChartView, palette: ChartPalette): uPlot.Options {
  return {
    width: view.width,
    height: view.height,
    padding: [10, 46, 24, 34],
    legend: { show: true },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: true }, y: { range: [0, 100] } },
    axes: [
      { stroke: palette.text, grid: { stroke: palette.grid, width: 1 }, ticks: { stroke: palette.grid, width: 1 } },
      {
        stroke: palette.text,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.grid, width: 1 },
        size: 34,
        splits: () => [0, 25, 50, 75, 100],
        values: (_self, splits) => splits.map((value) => `${value}%`),
      },
    ],
    series: toUplotSeries(view, palette),
  }
}
