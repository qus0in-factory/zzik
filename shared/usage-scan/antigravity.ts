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
export const AGY_QUOTA_RAW_SOURCE = 'agy-quota-cli';
const KNOWN_CLI_BUCKETS: Record<string, { id: string; window: string }> = {
  'gemini models\u0000weekly limit remaining': { id: 'gemini-weekly', window: 'weekly' },
  'gemini models\u0000five hour limit remaining': { id: 'gemini-5h', window: '5h' },
  'claude and gpt models\u0000weekly limit remaining': { id: '3p-weekly', window: 'weekly' },
  'claude and gpt models\u0000five hour limit remaining': { id: '3p-5h', window: '5h' },
};
export function hasAntigravityShape(raw: unknown): raw is Record<string, unknown> {
  return isRecord(raw) && (raw.source === AGY_QUOTA_RAW_SOURCE ? Array.isArray(raw.rows) : Array.isArray(raw.groups));
}
/** Value-only mapping. An empty window means no observed cycle; UI supplies its label. */
export function readAntigravityCliBucket(group: string, label: string): { id: string; window: string } {
  const known = KNOWN_CLI_BUCKETS[`${group.trim().toLowerCase()}\u0000${label.trim().toLowerCase()}`];
  if (known !== undefined) return known;
  if (group.trim().toLowerCase() === 'gemini 4 argon') return { id: 'argon-weekly', window: 'weekly' };
  const window = /weekly/i.test(label) ? 'weekly' : /five hour/i.test(label) ? '5h' : '';
  return { id: `cli:${group}:${label}`, window };
}
function readCliRows(rows: unknown[]) {
  const buckets: AntigravityValue[] = [];
  const problems: { kind: 'entry' | 'utilization'; path: string }[] = [];
  const groupIndexes = new Map<string, number>();
  const usedIds = new Set<string>();
  rows.forEach((row: unknown, bucketIndex: number) => {
    const path = 'rows[' + bucketIndex + ']';
    if (!isRecord(row) || !nonempty(row.group) || !nonempty(row.label)) {
      problems.push({ kind: 'entry', path });
      return;
    }
    const percent = row.remainingPercent;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      problems.push({ kind: 'utilization', path });
      return;
    }
    const mapped = readAntigravityCliBucket(row.group, row.label);
    const id = usedIds.has(mapped.id) ? path : mapped.id;
    usedIds.add(mapped.id);
    if (!groupIndexes.has(row.group)) groupIndexes.set(row.group, groupIndexes.size);
    buckets.push({
      id, groupIndex: groupIndexes.get(row.group)!, bucketIndex,
      window: mapped.window,
      usedPercent: Math.max(0, Math.min(100, 100 - percent)),
      resetsAt: typeof row.resetsAt === 'string' && Number.isFinite(Date.parse(row.resetsAt)) ? row.resetsAt : null,
    });
  });
  return { buckets, problems };
}
/** Keeps API shape handling in one module; never reads clocks or credentials. */
export function readAntigravity(raw: unknown) {
  if (isRecord(raw) && raw.source === AGY_QUOTA_RAW_SOURCE) return readCliRows(Array.isArray(raw.rows) ? raw.rows : []);
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
