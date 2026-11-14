/**
 * ui ↔ app 경계 타입(ADR 0.7 11절). T0에서는 타입만 동결한다 — 구현은 T3에서 한다.
 * ui는 이 타입의 값만 받아 그리고, 판정·문구·좌표는 app이 만든다.
 * 좌표는 전부 SVG 사용자 단위(px)이고 원점은 SVG 왼쪽 위다.
 */
import type { ChartRange } from '@domain/usage/history/types'
import type { UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { ChartViewInput } from './chart-view-input'
import { buildSeries } from '@domain/usage/history/series'
import {
  CHART_Y_TICKS,
  chartPlot,
  dashForSlot,
  nearestIndex,
  slotForOrdinal,
  xForTime,
  xTickPositions,
  yForPercent,
  yTickPositions,
} from '@domain/usage/history/chart-geometry'
import { CHART_MESSAGES, CHART_RANGE_TEXT, formatTime, percentText } from './chart-messages'

/** 상태 줄의 차트 버튼 상태. 비활성은 숨기지 않고 사유(hint)를 연결한다. */
export interface ChartButtonState {
  label: '차트 보기' | '차트 닫기'
  expanded: boolean
  disabled: boolean
  hint: string | null
  panelId: string
  onToggle(): void
  onIntent(): void
}

/** 한 계열. 배열 순서는 범례 순서이고 레코드의 seriesOrder 순이다. */
export interface ChartSeriesView {
  /** 계열 id(카드 id). ChartStopValue.seriesId와 같은 값. */
  id: string
  label: string
  /**
   * 색 슬롯. 1~8 = 팔레트(`--chart-1`~`--chart-8`), 0 = 9번째 이후(중립 회색 `--chart-overflow`).
   * seriesOrder의 순번(0부터)이 i일 때 i < 8이면 i + 1, 아니면 0. 숨김·범위·정렬로 바뀌지 않는다.
   */
  slot: number
  /** 기본 테마의 stroke-dasharray. 슬롯 1~3은 null(실선), 4~8과 0은 무늬 문자열. */
  dash: string | null
  /** 숨김이면 paths·dots는 빈 배열, endLabel은 null이고 stops에도 나오지 않는다. */
  hidden: boolean
  /** 구간마다 path의 d 하나. */
  paths: string[]
  /** 점이 하나뿐인 구간. */
  dots: { x: number; y: number }[]
  endLabel: { x: number; y: number; text: string } | null
}

/** 한 시점에서 한 계열의 값. */
export interface ChartStopValue {
  seriesId: string
  /** 그 시각에 유효한 사용률. 100을 넘어도 자르지 않은 실제 값. 틈(값 없음)이면 null. */
  percent: number | null
  /** 표시 문구. `42%`, `104%`, 값이 없으면 `—`. */
  text: string
  /** 십자선 위 표식의 y. percent가 null이면 null. 100을 넘으면 100의 위치. */
  y: number | null
}

/** 십자선이 붙을 수 있는 시점 하나. 툴팁과 range 입력이 이것만으로 그려진다. */
export interface ChartStop {
  /** epoch ms. 표본의 fetchedAt, 또는 마지막 원소에 한해 꼬리 끝 시각. */
  t: number
  /** 십자선의 x. plot 안쪽. */
  x: number
  /** 시각 문구(브라우저 현지 시각). 예: `11월 14일 10:15`. */
  label: string
  /** 보이는 계열 전부. percent 내림차순, null은 뒤, 같으면 series 순서. */
  values: ChartStopValue[]
  /** range 입력의 aria-valuetext. 예: `11월 14일 10:15 — 5시간 한도 42%, 주간 한도 18%`. */
  valueText: string
}

export interface ChartView {
  range: ChartRange
  /** SVG 전체 크기(viewBox `0 0 width height`). */
  width: number
  height: number
  /** 선이 그려지는 영역. 격자선은 x~x+width, 십자선은 y~y+height, 적중 영역도 이 사각형. */
  plot: { x: number; y: number; width: number; height: number }
  /** SVG <title>. 예: `Claude 사용률 추이 · 최근 7일`. */
  title: string
  /** SVG <desc>. 기간, 계열 수, 보이는 계열별 현재 값·기간 최고. */
  description: string
  xTicks: { x: number; label: string }[]
  yTicks: { y: number; label: string }[]
  /** 범위 안에 값이 있는 계열 전부(숨긴 것 포함). */
  series: ChartSeriesView[]
  /** x 오름차순(같은 x 없음). 표본 시각 그대로이고 솎지 않는다. 최대 4,001개. 그릴 것이 없으면 빈 배열. */
  stops: ChartStop[]
  table: { id: string; label: string; current: string; peak: string; low: string; resets: number }[]
  empty: 'none' | 'no_points' | 'all_hidden'
}

export type ChartPanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; view: ChartView; syncing: boolean; progress: string | null; note: string | null }

/** 패널의 조작. 뷰(ChartView)와 상태(ChartPanelState)에 넣지 않는다 — 데이터가 바뀌어도 참조가 유지돼야 한다. */
export interface ChartPanelActions {
  onSelectRange(range: ChartRange): void
  /** 그 계열의 표시 여부를 뒤집는다. 슬롯 0 계열도 같은 콜백을 쓴다. */
  onToggleSeries(seriesId: string): void
  /** 슬롯 1~8의 숨김을 모두 푼다. 슬롯 0 계열의 상태는 바꾸지 않는다. */
  onShowAllSeries(): void
  /** phase가 'error'일 때의 다시 시도. */
  onRetry(): void
  /** ui가 잰 SVG 크기를 알린다. app은 이 크기로 ChartView를 다시 만든다. */
  onResize(size: { width: number; height: number }): void
}

/** `UsageHistoryPanel`의 프롭 전부. */
export interface UsageHistoryPanelProps {
  /** ChartButtonState.panelId와 같은 값(aria-controls의 대상 id). */
  panelId: string
  /** region의 aria-label. 예: `Claude 사용률 추이`. */
  regionLabel: string
  /** 선택된 범위. phase가 'loading'·'error'여도 탭을 그릴 수 있게 view 밖에 둔다. */
  range: ChartRange
  state: ChartPanelState
  actions: ChartPanelActions
}

/** `useUsageHistoryPanel(provider)`의 반환. panel이 null이면 닫힌 상태(패널을 렌더하지 않는다). */
export interface UsageHistoryPanelBinding {
  button: ChartButtonState
  panel: UsageHistoryPanelProps | null
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 이하 T3 구현. 위의 타입은 T0에서 동결된 것이므로 건드리지 않는다.
 * T2의 ChartViewInput(HistoryDeps.buildView가 주입) 시그니처를 그대로 쓴다.
 * 리셋·결측으로 끊긴 구간은 T2의 buildSeries(5.3절)가 이미 나눠 준 것을 받아 path로 옮긴다.
 * ───────────────────────────────────────────────────────────────────────────── */

const RANGE_MS: Record<ChartRange, number> = {
  '24h': 24 * 3_600_000,
  '7d': 7 * 24 * 3_600_000,
  '30d': 30 * 24 * 3_600_000,
}

type Segments = ReturnType<typeof buildSeries>[number]['segments']

function sampleTime(sample: UsageHistorySample): number | null {
  const ms = Date.parse(sample.fetchedAt ?? sample.runAt)
  return Number.isFinite(ms) ? ms : null
}

/** 시점 t를 덮는 구간의 "그 시각 이하 마지막 실점" 값. 보간하지 않고, 틈이면 null. */
function valueAt(segments: Segments, t: number): number | null {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const points = segments[i].points
    if (t < points[0].t || t > points[points.length - 1].t) continue
    let value = points[0].p
    for (const point of points) {
      if (point.t > t) break
      value = point.p
    }
    return value
  }
  return null
}

function allPoints(segments: Segments): { t: number; p: number }[] {
  return segments.flatMap((segment) => segment.points)
}

/**
 * uPlot에 넘기는 정렬 데이터(ADR 5.3절 구간 기반). ChartView 계약(T0 동결)을 바꾸지 않도록
 * 뷰와 함께 WeakMap으로 넘긴다. stops는 슬라이더·표·툴팁용 시점 목록으로 그대로 둔다.
 * - times: 초 단위 오름차순. 구간 점 + 구간 사이 null 슬롯 + from/to 경계.
 * - columns: 보이는 계열별 값. 구간 밖·끊김은 null.
 * - dots: 단일점 구간의 열별 times 인덱스(반지름 2px 점으로 그린다).
 */
export interface ChartAlignedData {
  times: number[]
  columns: (number | null)[][]
  dots: number[][]
  from: number
  to: number
}
const alignedByView = new WeakMap<ChartView, ChartAlignedData>()
export function chartAlignedData(view: ChartView): ChartAlignedData | null {
  return alignedByView.get(view) ?? null
}

/** 레코드 + 카드 라벨 + 설정 + 크기 → ChartView. T2가 HistoryDeps.buildView로 주입한다. */
export function buildChartView(input: ChartViewInput): ChartView {
  const { providerTitle, range, record, hidden, shown, cardLabels, size, nowMs } = input
  const from = nowMs - RANGE_MS[range]
  const to = nowMs
  const effectiveTail = input.tailEnd ?? nowMs
  const plot = chartPlot(size.width, size.height)
  const hiddenSet = new Set(hidden)
  const shownSet = new Set(shown)

  // B2: 선택 범위 [from, to] 안의 표본만 쓴다. anchor는 from 직전 경계를 채우도록 from으로 옮겨 포함한다.
  const inRange = (sample: UsageHistorySample): boolean => {
    const t = sampleTime(sample)
    return t !== null && t >= from && t <= to
  }
  const samples = record.samples.filter(inRange)
  const anchorTime = record.anchor === null ? null : sampleTime(record.anchor)
  const boundaryIso = new Date(from).toISOString()
  const anchor: UsageHistorySample | null =
    record.anchor !== null && record.anchor.values !== null && anchorTime !== null
      ? anchorTime < from
        ? { ...record.anchor, runAt: boundaryIso, fetchedAt: boundaryIso }
        : anchorTime <= to ? record.anchor : null
      : null
  const tailEnd = Math.max(from, Math.min(to, effectiveTail))

  // 스냅샷 시각을 못 받으면 now까지 마지막 값을 유지한 수평선(꼬리)을 이어 그린다.
  // 예전·혼합 버전 IndexedDB 기록의 추가 지출 계열은 무시한다(seriesOrder 슬롯은 유지해 색이 안 바뀐다).
  const built = buildSeries({ anchor, samples, tailEnd }).filter(
    (s) => input.provider !== 'claude' || s.id !== 'extra_usage',
  )
  const byId = new Map(built.map((item) => [item.id, item]))
  // seriesOrder는 추가만 한다 — 숨김·범위·정렬로 슬롯이 바뀌지 않는다
  const order = [...record.seriesOrder]
  for (const item of built) if (!order.includes(item.id)) order.push(item.id)

  const series: ChartSeriesView[] = []
  for (const id of order) {
    const data = byId.get(id)
    if (data === undefined) continue
    const slot = slotForOrdinal(order.indexOf(id))
    const isHidden = slot === 0 ? !shownSet.has(id) : hiddenSet.has(id)
    // 선 path 문자열은 만들지 않는다 — uPlot이 정렬 데이터로 직접 그린다(계약 필드는 유지).
    const paths: string[] = []
    const dots: { x: number; y: number }[] = []
    if (!isHidden) {
      for (const segment of data.segments) {
        if (segment.points.length === 1) {
          const p = segment.points[0]
          dots.push({ x: xForTime(p.t, from, to, plot), y: yForPercent(p.p, plot) })
        }
      }
    }
    series.push({ id, label: cardLabels[id] ?? record.labels[id] ?? id, slot, dash: dashForSlot(slot), hidden: isHidden, paths, dots, endLabel: null })
  }

  const visible = series.filter((s) => !s.hidden)

  // B1: 정렬 데이터는 buildSeries 구간 점들로 만들고, 인접한 구간 사이에 null 슬롯을 넣어
  // C1 만료 리셋·C2 조기 리셋·C3 계열 소멸·C4 실패 끊김을 uPlot의 틈으로 그린다.
  const timeSet = new Set<number>([from, to])
  const forcedNulls = visible.map(() => new Set<number>())
  visible.forEach((s, column) => {
    const segments = byId.get(s.id)!.segments
    for (const segment of segments) {
      for (const point of segment.points) timeSet.add(Math.max(from, Math.min(to, point.t)))
    }
    for (let i = 1; i < segments.length; i += 1) {
      const previous = segments[i - 1].points
      const prevEnd = previous[previous.length - 1].t
      const nextStart = segments[i].points[0].t
      const gap = nextStart > prevEnd ? (prevEnd + nextStart) / 2 : prevEnd + 1
      if (gap > from && gap < to) {
        timeSet.add(gap)
        forcedNulls[column].add(gap)
      }
    }
  })
  const timesMs = [...timeSet].sort((a, b) => a - b)
  const columns = visible.map((s, column) => timesMs.map((t) => (forcedNulls[column].has(t) ? null : valueAt(byId.get(s.id)!.segments, t))))
  const dots = visible.map((s) =>
    byId.get(s.id)!.segments
      .filter((segment) => segment.points.length === 1)
      .map((segment) => timesMs.indexOf(Math.max(from, Math.min(to, segment.points[0].t))))
      .filter((index) => index >= 0),
  )

  const stopTimes = new Set<number>()
  let lastSampleT = from
  for (const sample of samples) {
    const t = sampleTime(sample)
    if (t === null || t > to) continue
    if (t > lastSampleT) lastSampleT = t
    if (sample.values !== null && t >= from) stopTimes.add(t)
  }
  const tailStop = Math.max(from, Math.min(to, tailEnd))
  if (series.length > 0 && tailStop > lastSampleT) stopTimes.add(tailStop)
  const times = [...stopTimes].sort((a, b) => a - b)

  const ordinal = (id: string): number => series.findIndex((s) => s.id === id)
  const stops: ChartStop[] = times.map((t) => {
    const label = formatTime(t)
    const values: ChartStopValue[] = visible
      .map((s) => {
        const percent = valueAt(byId.get(s.id)!.segments, t)
        return { seriesId: s.id, percent, text: percent === null ? CHART_MESSAGES.gapText : percentText(percent), y: percent === null ? null : yForPercent(percent, plot) }
      })
      .sort((a, b) => {
        if (a.percent === null && b.percent === null) return ordinal(a.seriesId) - ordinal(b.seriesId)
        if (a.percent === null) return 1
        if (b.percent === null) return -1
        return b.percent - a.percent || ordinal(a.seriesId) - ordinal(b.seriesId)
      })
    const named = values.filter((v) => v.percent !== null).map((v) => `${series[ordinal(v.seriesId)].label} ${v.text}`).join(', ')
    return { t, x: xForTime(t, from, to, plot), label, values, valueText: named.length > 0 ? CHART_MESSAGES.stopValues(label, named) : CHART_MESSAGES.stopNoValues(label) }
  })

  const table = series.map((s) => {
    const segments = byId.get(s.id)!.segments
    const points = allPoints(segments)
    const resets = segments.slice(1).filter((segment, i) => segment.points[0].p < segments[i].points[segments[i].points.length - 1].p).length
    const peakPoint = points.reduce<{ t: number; p: number } | null>((best, p) => (best === null || p.p > best.p ? p : best), null)
    return {
      id: s.id,
      label: s.label,
      current: points.length > 0 ? percentText(points[points.length - 1].p) : CHART_MESSAGES.valueNone,
      peak: peakPoint === null ? CHART_MESSAGES.valueNone : `${percentText(peakPoint.p)} (${formatTime(peakPoint.t)})`,
      low: points.length > 0 ? percentText(Math.min(...points.map((p) => p.p))) : CHART_MESSAGES.valueNone,
      resets,
    }
  })

  const empty: ChartView['empty'] = series.length === 0 ? 'no_points' : visible.length === 0 ? 'all_hidden' : 'none'
  let description = CHART_MESSAGES.descriptionSpan(formatTime(from), formatTime(to), series.length, visible.length)
  for (const s of visible) {
    const points = allPoints(byId.get(s.id)!.segments)
    const current = points.length > 0 ? percentText(points[points.length - 1].p) : CHART_MESSAGES.currentNone
    const peak = points.length > 0 ? percentText(Math.max(...points.map((p) => p.p))) : CHART_MESSAGES.peakNone
    description += CHART_MESSAGES.descriptionSeries(s.label, current, peak)
  }
  if (empty === 'no_points') description += CHART_MESSAGES.noPointsSuffix
  if (empty === 'all_hidden') description += CHART_MESSAGES.allHiddenSuffix

  const view: ChartView = {
    range,
    width: size.width,
    height: size.height,
    plot,
    title: CHART_MESSAGES.title(providerTitle, CHART_RANGE_TEXT[range]),
    description,
    xTicks: xTickPositions(plot).map((x, i) => ({ x, label: formatTime(from + ((to - from) * i) / 4) })),
    yTicks: yTickPositions(plot).map((y, i) => ({ y, label: CHART_MESSAGES.percentTick(CHART_Y_TICKS[i]) })),
    series,
    stops,
    table,
    empty,
  }
  alignedByView.set(view, { times: timesMs.map((t) => t / 1000), columns, dots, from: from / 1000, to: to / 1000 })
  return view
}

/** 포인터 x에 가장 가까운 시점 인덱스. 비면 -1, 거리가 같으면 뒤쪽. ui는 이 함수만 부른다. */
export function nearestStopIndex(view: ChartView, x: number): number {
  return nearestIndex(view.stops.map((stop) => stop.x), x)
}
