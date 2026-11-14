import { isRecord } from './parts.ts';
const MAX_DEPTH = 4;
const WINDOW_FIELDS = ['limit_window_seconds', 'reset_at', 'reset_after_seconds'] as const;
export interface CodexValue {
  path: string;
  insideRateLimit: boolean;
  usedPercent: number;
  limitWindowSeconds: number | null;
  resetsAt: string | null;
}
function isWindowShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value))
    return false;
  return WINDOW_FIELDS.some((field) => Object.hasOwn(value, field));
}
function readPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function readWindowSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
/** `reset_at`(Unix 초) 우선, 없으면 `reset_after_seconds`를 수집 시각에 더한다(D6). */
function resolveResetsAt(entry: Record<string, unknown>, fetchedAtMs: number | null): string | null {
  const resetAt = entry['reset_at'];
  if (typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt > 0) {
    return new Date(resetAt * 1000).toISOString();
  }
  const after = entry['reset_after_seconds'];
  if (typeof after === 'number' && Number.isFinite(after) && after >= 0 && fetchedAtMs !== null) {
    return new Date(fetchedAtMs + after * 1000).toISOString();
  }
  return null;
}
export function readCodexWindows(raw: Record<string, unknown>, options: {
  fetchedAt?: string | null;
} = {}) {
  const fetchedMs = options.fetchedAt ? Date.parse(options.fetchedAt) : Number.NaN;
  const fetchedAtMs = Number.isNaN(fetchedMs) ? null : fetchedMs;
  const windows: CodexValue[] = [];
  const invalidPaths: string[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > MAX_DEPTH)
      return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        walk(item, `${path}[${index}]`, depth + 1);
      });
      return;
    }
    if (!isRecord(node))
      return;
    if (isWindowShape(node)) {
      const usedPercent = readPercent(node['used_percent']);
      if (usedPercent === null) {
        // 창처럼 생겼지만 값이 깨진 경우: 카드로 만들지 않고 형식 문제로 알린다.
        invalidPaths.push(path);
        return;
      }
      windows.push({
        path,
        insideRateLimit: path === 'rate_limit' || path.startsWith('rate_limit.'),
        usedPercent,
        limitWindowSeconds: readWindowSeconds(node['limit_window_seconds']),
        resetsAt: resolveResetsAt(node, fetchedAtMs),
      });
      return; // 창 객체 내부는 더 훑지 않는다.
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, path.length === 0 ? key : `${path}.${key}`, depth + 1);
    }
  };
  walk(raw, '', 0);
  return { windows, invalidPaths };
}
export function byWindowLength(a: CodexValue, b: CodexValue): number { const l = a.limitWindowSeconds ?? Infinity, r = b.limitWindowSeconds ?? Infinity; return l !== r ? l - r : a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }
