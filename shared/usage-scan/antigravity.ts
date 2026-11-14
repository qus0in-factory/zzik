export interface AntigravityValue {
  id: string;
  groupIndex: number;
  bucketIndex: number;
  window: string;
  usedPercent: number;
  resetsAt: string | null;
}
import { isRecord } from './parts.ts';
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Keeps API shape handling in one module; never reads clocks or credentials. */
export function readAntigravity(raw: unknown) {
  if (!isRecord(raw) || !Array.isArray(raw.groups))
    return { buckets: [], problems: [] };
  const counts = new Map<string, number>();
  for (const group of raw.groups) {
    if (!isRecord(group) || !Array.isArray(group.buckets))
      continue;
    for (const bucket of group.buckets) {
      if (isRecord(bucket) && nonempty(bucket.bucketId))
        counts.set(bucket.bucketId, (counts.get(bucket.bucketId) ?? 0) + 1);
    }
  }
  const buckets: AntigravityValue[] = [];
  const problems: {
    kind: 'entry' | 'utilization';
    path: string;
  }[] = [];
  raw.groups.forEach((group: unknown, groupIndex: number) => {
    if (!isRecord(group) || !Array.isArray(group.buckets)) {
      problems.push({ kind: 'entry', path: 'groups[' + groupIndex + ']' });
      return;
    }
    group.buckets.forEach((bucket: unknown, bucketIndex: number) => {
      const path = 'groups[' + groupIndex + '].buckets[' + bucketIndex + ']';
      if (!isRecord(bucket)) {
        problems.push({ kind: 'entry', path: path });
        return;
      }
      const fraction = bucket.remainingFraction;
      if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        problems.push({ kind: 'utilization', path: path });
        return;
      }
      buckets.push({
        id: nonempty(bucket.bucketId) && counts.get(bucket.bucketId) === 1 ? bucket.bucketId : path,
        groupIndex, bucketIndex,
        window: nonempty(bucket.window) ? bucket.window : '',
        usedPercent: Math.max(0, Math.min(100, (1 - fraction) * 100)),
        resetsAt: typeof bucket.resetTime === 'string' && Number.isFinite(Date.parse(bucket.resetTime)) ? bucket.resetTime : null,
      });
    });
  });
  return { buckets, problems };
}
export function antigravityCycleSeconds(window: string): number | null { return window === '5h' ? 18000 : window === 'weekly' ? 604800 : null; }
