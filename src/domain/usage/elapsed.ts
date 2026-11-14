/** Reset-cycle progress, with the clock supplied by the caller. */
export function elapsedPercent(resetsAt: string | null, seconds: number | null, now: Date): number | null {
  if (!resetsAt || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  const remaining = Date.parse(resetsAt) - now.getTime()
  if (!Number.isFinite(remaining)) return null
  return Math.max(0, Math.min(100, 100 * (1 - remaining / (seconds * 1000))))
}

export { cycleSeconds } from '../../../shared/usage-scan/claude.ts'
