import type { UsageLevel } from '@domain/usage/types'
import type { UsageCollectionStatus } from './load-usage'
import type { UsageUiStatus } from './useUsage'

/** 연결(수집) 상태등 색 단계: ok 초록, caution 노랑, danger 빨강, neutral 회색. */
export type ProviderStatusLevel = 'ok' | 'caution' | 'danger' | 'neutral'

export interface ProviderStatus {
  level: ProviderStatusLevel
  /** 짧은 상태 문구(sr-only 텍스트의 앞부분) */
  label: string
  /** 툴팁 문구: `수집 실패 · 토큰 만료 · 마지막 수집 10:09 (2분 전)` */
  description: string
}

/** 수집기 실패 사유(정상·stale·collector_down 외 모든 비정상 상태). */
const FAILURE_REASON: Record<string, string> = {
  rate_limited: '요청 제한',
  token_expired: '토큰 만료',
  auth_required: '인증 필요',
  auth_rejected: '인증 거부',
  no_credentials: '자격 증명 없음',
  upstream_error: '상류 오류',
  network_error: '네트워크 오류',
}

/**
 * 제공자 섹션 제목 옆 상태등 판정. 의미는 "연결(수집) 상태"뿐이다 — 사용량이 많거나 한도에 닿았는지는
 * 카드·막대가 보여 주므로 보지 않는다(한도 도달도 수집은 정상이라 초록).
 * - 초록: 수집 정상(봉투 없음 포함)
 * - 빨강: 요청 오류(데이터 없음), 또는 수집기 상태가 정상·stale·collector_down이 아닌 모든 실패(이전 데이터가 있어도)
 * - 노랑: 오래된 데이터·collector_down·일부 항목 읽기 실패(부분 실패)
 * - 회색: 로딩·알 수 없음
 */
export function providerStatusOf(input: {
  status: UsageUiStatus
  reportStatus: UsageLevel | null
  collectionStatus: UsageCollectionStatus | null
  /** 보고서에서 읽지 못한 항목 수(부분 실패) */
  issueCount: number
  lastSuccessText: string | null
}): ProviderStatus {
  const reason = input.collectionStatus === null ? undefined : FAILURE_REASON[input.collectionStatus]
  const base =
    input.status === 'loading' ? { level: 'neutral' as const, label: '불러오는 중' }
    : input.status === 'error' ? { level: 'danger' as const, label: '오류' }
    : reason !== undefined ? { level: 'danger' as const, label: `수집 실패 · ${reason}` }
    : input.collectionStatus === 'collector_down' ? { level: 'caution' as const, label: '수집기 응답 없음' }
    : input.status === 'stale' ? { level: 'caution' as const, label: '오래된 데이터' }
    : input.reportStatus === null || input.reportStatus === 'unknown' ? { level: 'neutral' as const, label: '데이터 없음' }
    : input.issueCount > 0 ? { level: 'caution' as const, label: '일부 항목을 읽지 못함' }
    : { level: 'ok' as const, label: '정상' }
  return { ...base, description: input.lastSuccessText === null ? base.label : `${base.label} · ${input.lastSuccessText}` }
}
