import { clampPercent, isoOrNull, secondsBetween } from './parts.ts';
export function readGrok(config: Record<string, unknown>) {
  const usedPercent = clampPercent(config.creditUsagePercent);
  return usedPercent === null ? null : { id: 'credits', usedPercent, resetsAt: isoOrNull(config.billingPeriodEnd), cycleSeconds: secondsBetween(config.billingPeriodStart, config.billingPeriodEnd) };
}
