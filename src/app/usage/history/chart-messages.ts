/**
 * 차트 UI 문구 후보(ADR 0.7 T3). shared/messages 병합 뒤 `t()`로 옮기기 전까지
 * 차트가 쓰는 문구를 이 파일 한 곳에 모아 둔다. 판정·좌표가 아니라 표시 문구만 있다.
 */
import type { ChartRange } from '@domain/usage/history/types'

export const CHART_RANGE_TEXT: Record<ChartRange, string> = { '24h': '24시간', '7d': '7일', '30d': '30일' }

/** 브라우저 현지 시각 `M월 D일 HH:mm`. */
export function formatTime(t: number): string {
  const date = new Date(t)
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 반올림한 정수 + %. 100을 넘어도 자르지 않는다(축만 100에서 자른다). */
export function percentText(percent: number): string {
  return `${Math.round(percent)}%`
}

export const CHART_MESSAGES = {
  title: (providerTitle: string, rangeText: string): string => `${providerTitle} 사용률 추이 · 최근 ${rangeText}`,
  regionLabel: (providerTitle: string): string => `${providerTitle} 사용률 추이`,
  descriptionSpan: (fromText: string, toText: string, total: number, visible: number): string =>
    `${fromText}부터 ${toText}까지. 계열 ${total}개 중 ${visible}개 표시.`,
  descriptionSeries: (label: string, current: string, peak: string): string => ` ${label} 현재 ${current}, 최고 ${peak}.`,
  noPointsSuffix: ' 표시할 이력이 없습니다.',
  allHiddenSuffix: ' 모든 계열이 숨겨져 있습니다.',
  currentNone: '현재 값 없음',
  peakNone: '최고 값 없음',
  valueNone: '값 없음',
  gapText: '—',
  stopNoValues: (label: string): string => `${label} — 값 없음`,
  stopValues: (label: string, named: string): string => `${label} — ${named}`,
  percentTick: (value: number): string => `${value}%`,

  chartOpen: '차트 보기',
  chartClose: '차트 닫기',
  showAll: '모두 표시',
  tableSummary: '표로 보기',
  tableHeaders: ['계열', '현재', '기간 최고', '기간 최저', '리셋'] as const,
  rangeGroupLabel: '기간',
  rangeInputLabel: '시점 선택',
  loading: '이력을 불러오는 중…',
  retry: '다시 시도',
  syncing: '동기화 중…',
  emptyNoPoints: '표시할 이력이 없습니다',
  emptyAllHidden: '모든 계열이 숨겨져 있습니다',
  errorPrefix: '이력을 불러오지 못했습니다',
} as const
