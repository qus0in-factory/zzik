import { USAGE_HISTORY_ANCHOR_ON, USAGE_HISTORY_CURSOR_RE, USAGE_HISTORY_INSTANT_RE, USAGE_HISTORY_LIMIT_MAX, USAGE_HISTORY_LIMIT_RE, USAGE_HISTORY_PAGE_LIMIT } from '../../../shared/usage-history-contract';
import type { UsageHistoryQuery } from '../../../shared/usage-history-contract';
/** Reject JS Date's normalization of impossible calendar days. */
export function historyInstant(value: string): string | null {
  if (!USAGE_HISTORY_INSTANT_RE.test(value))
    return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms))
    return null;
  const normalized = new Date(ms).toISOString();
  const expected = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => '.' + (fraction ?? '').padEnd(3, '0') + 'Z');
  return normalized === expected ? normalized : null;
}
export function parseCursor(value: string): {
  runAt: string;
  id: string;
} | null {
  const match = USAGE_HISTORY_CURSOR_RE.exec(value);
  if (!match || historyInstant(match[1]) === null || BigInt(match[2]) > 9223372036854775807n)
    return null;
  return { runAt: match[1], id: match[2] };
}
export function encodeCursor(runAt: string, id: string): string { return new Date(runAt).toISOString() + '_' + id; }
export function parseHistoryQuery(params: URLSearchParams): {
  ok: true;
  query: UsageHistoryQuery;
} | {
  ok: false;
  reason: 'invalid_query';
} {
  const invalid = { ok: false as const, reason: 'invalid_query' as const };
  const query: UsageHistoryQuery = { limit: USAGE_HISTORY_PAGE_LIMIT };
  for (const key of ['from', 'until'] as const) {
    const value = params.get(key);
    if (value !== null) {
      const at = historyInstant(value);
      if (at === null)
        return invalid;
      query[key] = at;
    }
  }
  const after = params.get('after');
  if (after !== null) {
    if (parseCursor(after) === null)
      return invalid;
    query.after = after;
  }
  const limit = params.get('limit');
  if (limit !== null) {
    if (!USAGE_HISTORY_LIMIT_RE.test(limit) || Number(limit) > USAGE_HISTORY_LIMIT_MAX)
      return invalid;
    query.limit = Number(limit);
  }
  if (params.get('anchor') === USAGE_HISTORY_ANCHOR_ON) {
    if (query.from === undefined)
      return invalid;
    query.anchor = true;
  }
  if (query.from !== undefined && query.until !== undefined && query.until <= query.from)
    return invalid;
  return { ok: true, query };
}
