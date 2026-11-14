/**
 * ChartView(동결 계약) → uPlot data/series/options 변환(순수).
 * 색은 CSS 변수에서 읽어 주입받는다 — 이 모듈은 DOM을 보지 않으므로 node에서 그대로 테스트된다.
 */
import type uPlot from 'uplot'
import type { ChartView } from '@app/usage/history/chart-view'
import { chartAlignedData } from '@app/usage/history/chart-view'
import type { ChartRange } from '@domain/usage/history/types'
import { formatAxisDate, formatAxisDayBoundary, formatAxisTime } from '@app/usage/history/chart-messages'

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

/**
 * x축 눈금 문구(axes.values). uPlot 기본값의 영문 '8:00am'·'11/14/26' 대신
 * 24시간은 'HH:mm', 7일·30일은 'M/D'로, 날짜가 바뀌는 첫 눈금에는 날짜를 함께 붙인다.
 */
export function xAxisValues(range: ChartRange) {
  return (_self: unknown, splits: number[]): (string | number | null)[] => {
    let previousDay: number | null = null
    return splits.map((seconds) => {
      const date = new Date(seconds * 1000)
      const dayKey = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
      const isBoundary = previousDay !== dayKey
      previousDay = dayKey
      if (range !== '24h') return formatAxisDate(seconds)
      return isBoundary ? formatAxisDayBoundary(seconds) : formatAxisTime(seconds)
    })
  }
}

/**
 * uPlot 정렬 데이터. B1: buildSeries의 segments(구간 점 + 유지점 + anchor 경계)를 쓰고
 * 구간 사이 null 슬롯으로 C1·C2·C3·C4 끊김을 그린다. stops는 슬라이더·표·툴팁용으로 남긴다.
 * 손으로 만든 뷰(정렬 데이터 없음)만 기존 stops 경로를 쓴다.
 */
export function toUplotData(view: ChartView): uPlot.AlignedData {
  const aligned = chartAlignedData(view)
  if (aligned !== null) return [aligned.times, ...aligned.columns] as uPlot.AlignedData
  const visible = view.series.filter((series) => !series.hidden)
  const xs = view.stops.map((stop) => stop.t / 1000)
  const columns = visible.map((series) =>
    view.stops.map((stop) => stop.values.find((value) => value.seriesId === series.id)?.percent ?? null),
  )
  return [xs, ...columns] as uPlot.AlignedData
}

/** 슬롯 색·4~8번 파선·숨김 제외를 uPlot series 옵션으로 옮긴다(0번은 x축 자리). */
export function toUplotSeries(view: ChartView, palette: ChartPalette): uPlot.Series[] {
  const aligned = chartAlignedData(view)
  const visible = view.series.filter((series) => !series.hidden)
  return [
    {},
    ...visible.map((series, column) => {
      // 단일점 구간은 점(지름 4px = 반지름 2px)으로 그린다. 점이 없으면 points를 켜지 않는다.
      const dotIndices = aligned?.dots[column] ?? []
      return {
        label: series.label,
        stroke: palette.slots[series.slot] ?? palette.slots[0],
        width: 2,
        dash: series.dash === null ? undefined : series.dash.split(' ').map(Number),
        spanGaps: false,
        points: { show: dotIndices.length > 0, size: 4, filter: dotIndices },
      } satisfies uPlot.Series
    }),
  ]
}

/**
 * y는 0~100 고정, x는 [from, to]로 고정(B2). 기본 범례는 끄고 우리 범례·툴팁 하나로 통일한다.
 * onCursor는 setCursor 훅이 알려주는 최근접 데이터 인덱스를 우리 툴팁에 전달한다.
 */
export function toUplotOptions(view: ChartView, palette: ChartPalette, onCursor?: (idx: number | null) => void): uPlot.Options {
  const aligned = chartAlignedData(view)
  return {
    width: view.width,
    height: view.height,
    padding: [10, 46, 24, 34],
    legend: { show: false },
    ...(onCursor === undefined ? {} : { hooks: { setCursor: [(self: uPlot) => onCursor(self.cursor.idx ?? null)] } }),
    cursor: { drag: { x: false, y: false } },
    scales: {
      x: { time: true, ...(aligned === null ? {} : { range: [aligned.from, aligned.to] as [number, number] }) },
      y: { range: [0, 100] },
    },
    axes: [
      {
        stroke: palette.text,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.grid, width: 1 },
        values: xAxisValues(view.range),
      },
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
