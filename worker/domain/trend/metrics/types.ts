/** metrics 섹션의 출처 포트·저장 타입. 순수 계산은 aa.ts / or.ts에 둔다. */
import type { TrendMetricsBlockStatus, TrendMetricsNote, TrendSection, TrendSectionPayload } from '../../../../shared/trend-contract'
import type { TrendSectionRow, TrendSourceStateRow } from '../store'

export type MetricsSourceFailureReason =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'http'
  | 'network'
  | 'invalid'
  | 'too_large'
  | 'storage'

export interface MetricsSourceFailure {
  ok: false
  reason: MetricsSourceFailureReason
  httpStatus: number | null
}

export interface AaModelEntry {
  slug: string
  name: string
  creator: string
  releaseDate: string | null
  intelligenceIndex: number
  priceIn: number | null
  priceOut: number | null
  /** 분야별 지수(0~100). 저장만 하고 공개 응답에는 넣지 않는다. */
  domains: Record<string, number>
}

export interface AaSnapshot {
  version: string
  entries: AaModelEntry[]
}

export type AaFetchResult = { ok: true; snapshot: AaSnapshot } | MetricsSourceFailure

export interface AaSource {
  id: string
  fetch(nowMs: number): Promise<AaFetchResult>
}

export interface OrRankingRow {
  day: string
  permaslug: string
  /** 십진 정수 문자열. 공급자별 토크나이저가 달라 모델 간 절대 비교에 쓰지 않는다. */
  totalTokens: string
}

export interface OrRankingMeta {
  version?: string
  startDate?: string
  endDate?: string
}

export interface OrRankingSnapshot {
  asOf: string
  /** meta.as_of가 있으면 source, 없으면 실행 시각(fetched)으로 표시한다. */
  asOfKind: 'source' | 'fetched'
  meta: OrRankingMeta
  rows: OrRankingRow[]
}

export type OrFetchResult = { ok: true; snapshot: OrRankingSnapshot } | MetricsSourceFailure

export interface OrRankingSource {
  id: string
  fetch(nowMs: number): Promise<OrFetchResult>
}

export interface AaSnapshotRow {
  day: string
  slug: string
  name: string
  creator: string
  intelligenceIndex: number
  domains: Record<string, number>
  priceIn: number | null
  priceOut: number | null
  releaseDate: string | null
  indexVersion: string
}

export interface MetricsStore {
  readSection(section: TrendSection): Promise<TrendSectionRow | null>
  writeSection(payload: TrendSectionPayload): Promise<string>
  readAaSnapshot(day: string): Promise<AaSnapshotRow[]>
  /** 해당 day의 스냅샷을 주어진 행으로 교체한다. */
  writeAaSnapshot(day: string, rows: readonly AaSnapshotRow[]): Promise<void>
  readOrRanking(fromDay: string, toDay: string): Promise<OrRankingRow[]>
  /** 주어진 행의 day들을 원자적으로 교체한다. */
  writeOrRanking(rows: readonly OrRankingRow[], asOf: string, meta: OrRankingMeta): Promise<void>
  /** 보존 기간이 지난 스냅샷을 지운다. */
  prune(beforeAaDay: string, beforeOrDay: string): Promise<void>
  writeSourceState?(row: TrendSourceStateRow): Promise<void>
}

export interface MetricsBlockSummary {
  status: TrendMetricsBlockStatus
  note?: TrendMetricsNote
}

const DAY_MS = 86_400_000

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`)
}

export function addDays(day: string, delta: number): string {
  return utcDay(dayMs(day) + delta * DAY_MS)
}
