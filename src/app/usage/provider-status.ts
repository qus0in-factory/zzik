import type { UsageLevel } from '@domain/usage/types'
import type { UsageUiStatus } from './useUsage'

/** 연결 상태등 색 단계: ok 초록, caution 노랑, danger 빨강, neutral 회색. */
export type ProviderStatusLevel = 'ok' | 'caution' | 'danger' | 'neutral'

export interface ProviderStatus {
  level: ProviderStatusLevel
  /** 짧은 상태 문구(sr-only 텍스트) */
  label: string
  /** 툴팁 문구: `정상 · 마지막 수집 10:09 (2분 전)` */
  description: string
}

const REPORT_STATUS: Record<UsageLevel, { level: ProviderStatusLevel; label: string }> = {
  normal: { level: 'ok', label: '정상' },
  warn: { level: 'caution', label: '주의' },
  limit: { level: 'danger', label: '한도 도달' },
  unknown: { level: 'neutral', label: '데이터 없음' },
}

/**
 * 제공자 섹션 제목 옆 상태등 판정. 새 규칙을 만들지 않고 기존 화면 상태(useUsage의 status)와
 * 수집 판정(report.status)을 색으로 옮긴다. 오류·로딩·오래된 데이터는 보고서 판정보다 먼저 본다.
 */
export function providerStatusOf(input: { status: UsageUiStatus; reportStatus: UsageLevel | null; lastSuccessText: string | null }): ProviderStatus {
  const base =
    input.status === 'loading' ? { level: 'neutral' as const, label: '불러오는 중' }
    : input.status === 'error' ? { level: 'danger' as const, label: '오류' }
    : input.status === 'stale' ? { level: 'caution' as const, label: '오래된 데이터' }
    : input.reportStatus === null ? { level: 'neutral' as const, label: '데이터 없음' }
    : REPORT_STATUS[input.reportStatus]
  return { ...base, description: input.lastSuccessText === null ? base.label : `${base.label} · ${input.lastSuccessText}` }
}
