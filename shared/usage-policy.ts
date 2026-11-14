/** Shared pure card policies. Node collector imports explicit .ts paths without bundling. */
export type PercentStatus = 'normal' | 'warn' | 'limit'
export type BarLevel = 'neutral' | 'ok' | 'caution' | 'danger'
export function getUsageStatus(percentage: number): PercentStatus {
  if (!Number.isFinite(percentage) || percentage < 0) throw new RangeError('Usage percentage must be a finite, non-negative number')
  return percentage >= 100 ? 'limit' : percentage >= 80 ? 'warn' : 'normal'
}
export function statusOf(percentage: number | null | undefined): PercentStatus | 'unknown' {
  return percentage == null ? 'unknown' : getUsageStatus(percentage)
}
export function barLevelOf(used: number | null | undefined, elapsed: number | null | undefined): BarLevel {
  if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) return 'neutral'
  if (used >= 90) return 'danger'
  if (typeof elapsed === 'number' && Number.isFinite(elapsed)) return used <= elapsed ? 'ok' : 'caution'
  return used >= 70 ? 'caution' : 'ok'
}
export function elapsedPercent(resetsAt: string | null, seconds: number | null, now: Date): number | null {
  if (!resetsAt || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  const remaining = Date.parse(resetsAt) - now.getTime()
  return Number.isFinite(remaining) ? Math.max(0, Math.min(100, 100 * (1 - remaining / (seconds * 1000)))) : null
}
interface SummaryWindow { id: string; cycleSeconds?: number | null; usedPercent: number | null }
export function summaryUnitOf(window: SummaryWindow): 'month' | 'week' | null {
  const seconds = window.cycleSeconds
  if (seconds == null) return null
  if (seconds >= 28 * 86400 && seconds <= 31 * 86400) return 'month'
  return seconds === 7 * 86400 ? 'week' : null
}
export function summaryWindowOf<T extends SummaryWindow>(windows: readonly T[], provider?: string): T | null {
  const eligible = windows.filter(w => (provider !== 'antigravity' || w.id.startsWith('gemini-')) && summaryUnitOf(w) !== null)
  const pool = eligible.some(w => summaryUnitOf(w) === 'month') ? eligible.filter(w => summaryUnitOf(w) === 'month') : eligible
  return pool.reduce<T | null>((top, w) => top === null || (w.usedPercent ?? -1) > (top.usedPercent ?? -1) ? w : top, null)
}
