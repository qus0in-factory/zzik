import type { UsageLevel } from '@domain/usage/types'
import type { UsageUiStatus } from './useUsage'

/** 연결(수집) 상태등 색 단계: ok 초록, caution 노랑, danger 빨강, neutral 회색. */
export type ProviderStatusLevel = 'ok' | 'caution' | 'danger' | 'neutral'

export interface ProviderStatus {
  level: ProviderStatusLevel
  /** 짧은 상태 문구(sr-only 텍스트) */
  label: string
  /** 툴팁 문구: `정상 · 마지막 수집 10:09 (7분 전)` */
  description: string
}

/**
 * 제공자 섹션 제목 옆 상태등 판정. 의미는 "연결(수집) 상태"뿐이다 — 사용량이 많거나 한도에 닿았는지는
 * 카드·막대가 보여 주므로 여기서는 보지 않는다(한도 도달도 수집은 정상이라 초록).
 * 빨강: 오류·수집 실패, 노랑: 오래된 데이터·일부 항목 읽기 실패, 회색: 로딩·알 수 없음.
 */
export function providerStatusOf(input: {
  status: UsageUiStatus
  reportStatus: UsageLevel | null
  /** 보고서에서 읽지 못한 항목 수(부분 실패) */
  issueCount?: number
  lastSuccessText: string | null
}): ProviderStatus {
  const base =
    input.status === 'loading' ? { level: 'neutral' as const, label: '불러오는 중' }
    : input.status === 'error' ? { level: 'danger' as const, label: '오류' }
    : input.status === 'stale' ? { level: 'caution' as const, label: '오래된 데이터' }
    : input.reportStatus === null || input.reportStatus === 'unknown' ? { level: 'neutral' as const, label: '데이터 없음' }
    : (input.issueCount ?? 0) > 0 ? { level: 'caution' as const, label: '일부 항목을 읽지 못함' }
    : { level: 'ok' as const, label: '정상' }
  return { ...base, description: input.lastSuccessText === null ? base.label : `${base.label} · ${input.lastSuccessText}` }
}
