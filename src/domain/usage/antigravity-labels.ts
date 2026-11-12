import type { UsageLabel } from './labels'
/** Provisional until G2b live KV verification; never infer unobserved periods. */
const WINDOWS: Record<string, { label: string; seconds: number }> = {
  '5h': { label: '5시간 한도', seconds: 18000 },
  weekly: { label: '주간 한도', seconds: 604800 },
}
export function antigravityCycleSeconds(window: string): number | null {
  return Object.hasOwn(WINDOWS, window) ? WINDOWS[window].seconds : null
}
export function antigravityLabel(group: string, window: string): UsageLabel {
  const known = Object.hasOwn(WINDOWS, window) ? WINDOWS[window] : undefined
  return { label: group + ' · ' + (known?.label ?? window + ' 한도'), unknown: known === undefined }
}
