import { clampPercent, isoOrNull, isRecord, secondsBetween } from './parts.ts';
export function readOllamaIncluded(included: Record<string, unknown>) {
  const allowance = included.allowance_usd, balance = included.balance_usd;
  if (typeof allowance !== 'number' || !Number.isFinite(allowance) || allowance <= 0 || typeof balance !== 'number' || !Number.isFinite(balance))
    return null;
  const period = isRecord(included.period) ? included.period : {};
  return { id: 'included', usedPercent: clampPercent((allowance - balance) / allowance * 100) ?? 0, resetsAt: isoOrNull(period.until), cycleSeconds: secondsBetween(period.from, period.until) };
}
