/**
 * ChartView(동결 계약) → uPlot data/series/options 변환(순수).
 * 색은 CSS 변수에서 읽어 주입받는다 — 이 모듈은 DOM을 보지 않으므로 node에서 그대로 테스트된다.
 */
import type uPlot from 'uplot'
import type { ChartStop, ChartView } from '@app/usage/history/chart-view'
import { chartAlignedData, chartCursorAtTime } from '@app/usage/history/chart-view'
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

const DAY_SEC = 86_400
const HOUR_SEC = 3_600
/** 7일·30일: 하루 단위 눈금만 허용(86400초 배수). 넓은 화면에서도 12시간 간격이 섞이지 않는다. */
export const DAY_INCRS = [DAY_SEC, 2 * DAY_SEC, 3 * DAY_SEC, 7 * DAY_SEC, 14 * DAY_SEC, 30 * DAY_SEC]
/** 24시간: 시간 단위 눈금(HH:mm). */
export const HOUR_INCRS = [HOUR_SEC, 2 * HOUR_SEC, 3 * HOUR_SEC, 4 * HOUR_SEC, 6 * HOUR_SEC, 8 * HOUR_SEC, 12 * HOUR_SEC]
/** 라벨이 겹치지 않게 눈금 사이 최소 간격(px). */
export const MINUTE_INCRS = [60, 120, 180, 300, 600, 900, 1800, ...HOUR_INCRS]
export const AXIS_MIN_SPACE = 60

/**
 * x축 눈금 문구(axes.values). uPlot 기본값의 영문 '8:00am'·'11/14/26' 대신
 * 24시간은 'HH:mm'(날짜가 바뀌는 첫 눈금만 'M/D HH:mm'), 7일·30일은 날짜 하나씩 'M/D'.
 * 7일·30일은 같은 날짜가 두 번 나오지 않도록 첫 눈금만 라벨을 남기고 나머지는 null로 숨긴다.
 */
export function xAxisValues(range: ChartRange) {
  return (_self: unknown, splits: number[]): (string | number | null)[] => {
    let previousDay: number | null = null
    return splits.map((seconds) => {
      const date = new Date(seconds * 1000)
      const dayKey = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
      const isBoundary = previousDay !== dayKey
      previousDay = dayKey
      if (range === '24h') return isBoundary ? formatAxisDayBoundary(seconds) : formatAxisTime(seconds)
      return isBoundary ? formatAxisDate(seconds) : null
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
  const visible = [...view.series.filter((series) => !series.hidden), ...(view.pace == null ? [] : [view.pace])]
  const xs = view.stops.map((stop) => stop.t / 1000)
  const columns = visible.map((series) =>
    view.stops.map((stop) => stop.values.find((value) => value.seriesId === series.id)?.percent ?? null),
  )
  return [xs, ...columns] as uPlot.AlignedData
}

/** 슬롯 색·숨김 제외를 uPlot series 옵션으로 옮긴다(0번은 x축 자리). 실제 사용량 계열은 항상 실선이고, 시간 대비 예상 보조선만 파선이다. */
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
        dash: undefined,
        spanGaps: false,
        points: { show: dotIndices.length > 0, size: 4, filter: dotIndices },
      } satisfies uPlot.Series
    }),
    ...(view.pace == null ? [] : [{ label: view.pace.label, stroke: palette.slots[0], width: 2, dash: [6, 4], spanGaps: false, points: { show: false } } satisfies uPlot.Series]),
  ]
}

/**
 * y는 0~100 고정, x는 제공자의 수집 구간 [from, to](최소 3분)이다. 기본 범례는 끄고 우리 범례·툴팁 하나로 통일한다.
 * onCursor는 커서 x를 시간으로 변환해 같은 시각의 값을 전달한다. 두 배열의 인덱스를 섞지 않는다.
 */
export function toUplotOptions(view: ChartView, palette: ChartPalette, onCursor?: (point: ChartStop | null) => void): uPlot.Options {
  const aligned = chartAlignedData(view)
  const span = aligned === null ? null : aligned.to - aligned.from
  const timeAxis = view.range === '24h' || (span !== null && span <= DAY_SEC)
  return {
    width: view.width,
    height: view.height,
    padding: [10, 46, 24, 34],
    legend: { show: false },
    ...(onCursor === undefined ? {} : { hooks: { setCursor: [(self: uPlot) => onCursor(self.cursor.left === undefined || self.cursor.left < 0 || self.cursor.top === undefined || self.cursor.top < 0 ? null : chartCursorAtTime(view, Math.round(self.posToVal(self.cursor.left, 'x') * 1000)))] } }),
    cursor: { points: { show: false }, drag: { x: false, y: false } },
    scales: {
      x: { time: true, ...(aligned === null ? {} : { range: [aligned.from, aligned.to] as [number, number] }) },
      y: { range: [0, 100] },
    },
    axes: [
      {
        stroke: palette.text,
        grid: { stroke: palette.grid, width: 1 },
        ticks: { stroke: palette.grid, width: 1 },
        space: AXIS_MIN_SPACE,
        incrs: span !== null && span < 3 * HOUR_SEC ? MINUTE_INCRS : timeAxis ? HOUR_INCRS : DAY_INCRS,
        values: xAxisValues(timeAxis ? '24h' : view.range),
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
