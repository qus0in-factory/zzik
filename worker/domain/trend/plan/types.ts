/** plan-models 관측 포트·저장 타입. 관측 로그는 수집기(0003)와 Worker 공개 출처가 함께 쓴다. */
import type {
  TrendPlanConfidence,
  TrendPlanGroup,
  TrendSection,
  TrendSectionPayload,
} from '../../../../shared/trend-contract'
import type { TrendSectionRow } from '../store'

export type PlanSourceFailureReason = 'http' | 'network' | 'invalid' | 'too_large'

export interface PlanSourceFailure {
  ok: false
  reason: PlanSourceFailureReason
  httpStatus: number | null
}

export interface PlanObservation {
  plan: string
  modelId: string
  displayName: string | null
  source: string
  confidence: TrendPlanConfidence
}

export type PlanFetchResult = { ok: true; observations: PlanObservation[] } | PlanSourceFailure

export interface PlanSource {
  id: string
  plan: string
  fetch(nowMs: number): Promise<PlanFetchResult>
}

export interface PlanObservationRow {
  plan: string
  modelId: string
  displayName: string | null
  source: string
  confidence: TrendPlanConfidence
  firstSeenAt: number
  lastSeenAt: number
  baseline: boolean
}

export interface PlanSectionPayload extends TrendSectionPayload {
  plans: TrendPlanGroup[]
}

export interface PlanStore {
  readSection(section: TrendSection): Promise<TrendSectionRow | null>
  writeSection(payload: TrendSectionPayload): Promise<string>
  readObservations(): Promise<PlanObservationRow[]>
  /** plan 단위 첫 관측이면 baseline=1, 이후 관측은 기존 first_seen_at/baseline을 유지한다. */
  upsertObservations(plan: string, source: string, observations: readonly PlanObservation[], nowMs: number): Promise<void>
}
