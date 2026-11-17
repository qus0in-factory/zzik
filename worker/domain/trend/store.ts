import type { TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import type { PlanObservationRow } from './plan/types'

export interface TrendSectionRow {
  section: TrendSection
  payload: string
  payloadSha256: string
  generatedAt: number
}

export interface TrendSourceStateRow {
  source: string
  etag: string | null
  fetchedAt: number
  ok: boolean
  httpStatus: number | null
}

export const TREND_SECTION_STATE_PREFIX = 'section:'

/** 섹션 평가 성공 시각을 trend_source_state에 기록할 때 쓰는 가상 source id. */
export function sectionStateSourceId(section: TrendSection): string {
  return `${TREND_SECTION_STATE_PREFIX}${section}`
}

export interface TrendStore {
  readSection(section: TrendSection): Promise<TrendSectionRow | null>
  readSections(): Promise<TrendSectionRow[]>
  /** payload를 저장하고 payload_sha256을 반환한다. 100KB를 넘으면 거부한다. */
  writeSection(payload: TrendSectionPayload): Promise<string>
  readSourceState(source: string): Promise<TrendSourceStateRow | null>
  readSourceStates?(): Promise<TrendSourceStateRow[]>
  writeSourceState(row: TrendSourceStateRow): Promise<void>
  /** plan-models 관측 테이블(0003). free-models가 요금제 포함 목록을 읽는다. */
  readPlanObservations?(): Promise<PlanObservationRow[]>
}
