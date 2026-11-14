/**
 * 차트 뷰를 만드는 입력과 빌더의 자리(ADR 0.7 11절). `buildChartView`(좌표·구간 path·stops·표)는 T3가 구현하고,
 * T2의 훅은 이 시그니처로 주입받는다. 배선 때 T3의 구현을 `HistoryDeps.buildView`에 넣는다.
 */
import type { HistoryCacheRecord, ChartRange } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import type { ChartView } from './chart-view'
import { t } from '@shared/messages'
import type { MessageKey } from '@shared/messages'

export interface ChartViewInput {
  provider: UsageProvider
  /** 제공자 제목(`Claude`). title·description에 쓴다 */
  providerTitle: string
  record: HistoryCacheRecord
  /** 꼬리의 끝(스냅샷 fetchedAt, epoch ms). 모르면 null */
  tailEnd: number | null
  range: ChartRange
  /** 설정에서 숨긴 계열 id(슬롯 1~8) */
  hidden: readonly string[]
  /** 설정에서 켠 9번째 이후 계열 id */
  shown: readonly string[]
  /** 지금 화면 카드의 라벨(id → 라벨). 없으면 레코드가 기억한 라벨, 그것도 없으면 id */
  cardLabels: Readonly<Record<string, string>>
  size: { width: number; height: number }
  /** 지금(epoch ms). x축 범위의 오른쪽 끝 계산용 */
  nowMs: number
}

export type ChartViewBuilder = (input: ChartViewInput) => ChartView

/** 범위 → 문구 키. */
export const RANGE_MESSAGE_KEY = { '24h': 'chart.range.24h', '7d': 'chart.range.7d', '30d': 'chart.range.30d' } as const satisfies Record<ChartRange, MessageKey>

export const DEFAULT_CHART_SIZE = { width: 640, height: 240 } as const

/** 아직 T3의 구현이 없을 때의 자리 구현: 그릴 것이 없는 빈 뷰. */
export const emptyChartViewBuilder: ChartViewBuilder = (input) => ({
  range: input.range,
  width: input.size.width,
  height: input.size.height,
  plot: { x: 40, y: 8, width: Math.max(0, input.size.width - 48), height: Math.max(0, input.size.height - 32) },
  title: t('chart.title', { provider: input.providerTitle, range: t(RANGE_MESSAGE_KEY[input.range]) }),
  description: t('chart.empty.description', { provider: input.providerTitle }),
  xTicks: [],
  yTicks: [],
  series: [],
  stops: [],
  table: [],
  empty: 'no_points',
})
