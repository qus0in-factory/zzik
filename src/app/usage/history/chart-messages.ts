/**
 * 차트 UI 문구 접근자(ADR 0.7 T3). 문구 자체는 `shared/messages`(ko.ts)에 있고, 여기서는 차트가 쓰던 모양
 * (`CHART_MESSAGES`·`formatTime`·`percentText`)으로 `t()`를 감싼다. 판정·좌표가 아니라 표시 문구만 있다.
 */
import { t } from '@shared/messages'
import type { ChartRange } from '@domain/usage/history/types'

export const CHART_RANGE_TEXT: Record<ChartRange, string> = { '24h': t('chart.range.24h'), '7d': t('chart.range.7d'), '30d': t('chart.range.30d') }

/** 브라우저 현지 시각(예: `11월 14일 10:15`). */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  return t('chart.time', { month: date.getMonth() + 1, day: date.getDate(), hour: String(date.getHours()).padStart(2, '0'), minute: String(date.getMinutes()).padStart(2, '0') })
}

/** 반올림한 정수 + %. 100을 넘어도 자르지 않는다(축만 100에서 자른다). */
export function percentText(percent: number): string {
  return `${Math.round(percent)}%`
}

/** uPlot x축 눈금은 초 단위 epoch를 받는다. 현지 시각 기준으로 한국어 눈금 문구를 만든다. */
export function formatAxisTime(seconds: number): string {
  const date = new Date(seconds * 1000)
  return t('chart.axis.time', { hour: String(date.getHours()).padStart(2, '0'), minute: String(date.getMinutes()).padStart(2, '0') })
}

export function formatAxisDate(seconds: number): string {
  const date = new Date(seconds * 1000)
  return t('chart.axis.date', { month: date.getMonth() + 1, day: date.getDate() })
}

/** 날짜가 바뀌는 첫 눈금에는 날짜를 함께 붙인다. */
export function formatAxisDayBoundary(seconds: number): string {
  return t('chart.axis.dayBoundary', { date: formatAxisDate(seconds), time: formatAxisTime(seconds) })
}

export const CHART_MESSAGES = {
  title: (providerTitle: string, rangeText: string): string => t('chart.title', { provider: providerTitle, range: rangeText }),
  regionLabel: (providerTitle: string): string => t('chart.regionLabel', { provider: providerTitle }),
  descriptionSpan: (fromText: string, toText: string, total: number, visible: number): string => t('chart.desc.span', { from: fromText, to: toText, total, visible }),
  descriptionSeries: (label: string, current: string, peak: string): string => ` ${t('chart.desc.series', { label, current, peak })}`,
  noPointsSuffix: ` ${t('chart.desc.noPoints')}`,
  allHiddenSuffix: ` ${t('chart.desc.allHidden')}`,
  currentNone: t('chart.current.none'),
  peakNone: t('chart.peak.none'),
  valueNone: t('chart.value.none'),
  gapText: '—',
  cursorTime: t('chart.cursor.time'),
  stopNoValues: (label: string): string => t('chart.stop.noValues', { label }),
  stopValues: (label: string, named: string): string => t('chart.stop.values', { label, values: named }),
  percentTick: (value: number): string => `${value}%`,

  chartOpen: t('chart.open'),
  chartClose: t('chart.close'),
  showAll: t('chart.showAll'),
  tableSummary: t('chart.table.summary'),
  tableHeaders: [t('chart.table.series'), t('chart.table.current'), t('chart.table.peak'), t('chart.table.low'), t('chart.table.resets')] as const,
  rangeGroupLabel: t('chart.range.group'),
  rangeInputLabel: t('chart.range.input'),
  loading: t('chart.loading'),
  retry: t('action.retry'),
  syncing: t('chart.syncing'),
  emptyNoPoints: t('chart.empty.noPoints'),
  emptyAllHidden: t('chart.empty.allHidden'),
  errorPrefix: t('chart.error.prefix'),
} as const
