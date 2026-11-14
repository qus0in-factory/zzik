import type { ExtraSpend } from './types'
/** Financial fields are not subscription quotas. Monetary units are not a verified contract. */
export function extraSpendOf(value: unknown): ExtraSpend | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  return {
    enabled: typeof raw.is_enabled === 'boolean' ? raw.is_enabled : null,
    limitReached: typeof raw.spend_limit_reached === 'boolean' ? raw.spend_limit_reached : null,
    usedPercent: typeof raw.utilization === 'number' && Number.isFinite(raw.utilization) && raw.utilization >= 0 ? raw.utilization : null,
  }
}
