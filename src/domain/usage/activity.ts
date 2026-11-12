/** Percentage point change and animation speed, independent of clocks and UI. */
export function usageActivity(previous: number | null, current: number | null): { delta: number; lapSeconds: number } | null {
  if (previous === null || current === null || !Number.isFinite(previous) || !Number.isFinite(current) || current <= 0) return null
  const delta = Math.abs(current - previous)
  return delta === 0 ? null : { delta, lapSeconds: Math.max(0.25, Math.min(1.2, 1.2 / delta)) }
}
