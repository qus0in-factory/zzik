export type UsageStatus = 'normal' | 'warn' | 'limit'

/** Percentages above 100 are valid overages; negative or non-finite values are invalid. */
export function getUsageStatus(percentage: number): UsageStatus {
  if (!Number.isFinite(percentage) || percentage < 0) {
    throw new RangeError('Usage percentage must be a finite, non-negative number')
  }
  if (percentage >= 100) return 'limit'
  if (percentage >= 80) return 'warn'
  return 'normal'
}

/** 값이 없는 항목(null)을 'unknown'으로 처리하는 null-safe 래퍼. getUsageStatus 계약은 불변(시나리오 D13). */
export function statusOf(percentage: number | null | undefined): UsageStatus | 'unknown' {
  if (percentage === null || percentage === undefined) return 'unknown'
  return getUsageStatus(percentage)
}
