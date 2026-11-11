import { statusOf } from '../usage-status'
import type { UsageLevel } from './types'

/** 파싱된 utilization(또는 null)을 표시 단계로 바꾼다. 임계값은 기존 getUsageStatus를 그대로 쓴다(C4). */
export function usageLevelOf(usedPercent: number | null): UsageLevel {
  if (usedPercent === null) return 'unknown'
  return statusOf(usedPercent)
}

export interface AggregateEntry {
  status: UsageLevel
  expired: boolean
}

/**
 * 항목 단계를 하나의 보고서 단계로 집계한다 (시나리오 C5~C7).
 * - 만료된 항목은 집계에서 제외되지만, 값이 있었다는 사실은 유지한다(전부 만료면 normal).
 * - 남은 항목이 전부 값 없음(unknown)이면 unknown, 입력이 비었으면 unknown.
 */
export function aggregateUsageLevel(entries: ReadonlyArray<AggregateEntry>): UsageLevel {
  const active = entries.filter((entry) => !entry.expired)
  if (active.some((entry) => entry.status === 'limit')) return 'limit'
  if (active.some((entry) => entry.status === 'warn')) return 'warn'
  if (active.some((entry) => entry.status === 'normal')) return 'normal'
  if (active.length > 0) return 'unknown'
  if (entries.some((entry) => entry.status !== 'unknown')) return 'normal'
  return 'unknown'
}
