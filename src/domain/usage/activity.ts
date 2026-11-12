/** Percentage point change and animation speed, independent of clocks and UI. */
export function usageActivity(previous: number | null, current: number | null): { delta: number; lapSeconds: number } | null {
  if (previous === null || current === null || !Number.isFinite(previous) || !Number.isFinite(current)) return null
  const delta = Math.abs(current - previous)
  return delta === 0 ? null : { delta, lapSeconds: Math.max(0.8, Math.min(8, 8 / delta)) }
}
