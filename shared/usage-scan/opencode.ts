import { clampPercent, isoOrNull, monthlyCycleSeconds } from './parts.ts';
export const OPENCODE_KEYS = ['rolling', 'weekly', 'monthly'] as const;
export function opencodeKeys(usage: Record<string, unknown>): string[] { return [...OPENCODE_KEYS.filter(k => k in usage), ...Object.keys(usage).filter(k => !(OPENCODE_KEYS as readonly string[]).includes(k)).sort()]; }
export function readOpencodeWindow(id: string, entry: Record<string, unknown>) {
  const usedPercent = clampPercent(entry.percent);
  if (usedPercent === null)
    return null;
  const resetsAt = isoOrNull(entry.resetsAt);
  return { id, usedPercent, resetsAt, cycleSeconds: id === 'monthly' ? monthlyCycleSeconds(resetsAt) : id === 'weekly' ? 604800 : null };
}
