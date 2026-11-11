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
