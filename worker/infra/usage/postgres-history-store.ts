import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { usageEvent } from '../../../shared/db/schema';
import { USAGE_HISTORY_MIN_OK_EVENTS } from '../../../shared/usage-history-contract';
import type { UsageHistoryQuery, UsageHistorySummaryEntry } from '../../../shared/usage-history-contract';
import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract';
import { parseCursor } from '../../domain/usage/history-query';
import type { HistoryResult, HistoryRow, HistoryStore } from '../../domain/usage/history-store';
import type { SnapshotDatabase } from './postgres-snapshot-store';
const runAt = sql<string> `to_char(${usageEvent.runAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const fields = {
  id: sql<string>`${usageEvent.id}::text`,
  runAt,
  status: sql<UsageStatus>`${usageEvent.status}`,
  fetchedAt: sql<string | null>`${usageEvent.envelope}->>'fetchedAt'`,
  intervalSec: sql<string | null>`${usageEvent.envelope}->>'intervalSec'`,
  rawText: sql<string | null>`CASE WHEN ${usageEvent.status} = 'ok' THEN ${usageEvent.envelope}->>'rawText' END`,
  rawRedacted: sql<unknown>`CASE WHEN ${usageEvent.status} = 'ok' THEN ${usageEvent.envelope}->'rawRedacted' END`,
};
/** Bounded read-only statements, using the existing provider/run_at index. */
export class PostgresHistoryStore implements HistoryStore {
  constructor(private readonly db: SnapshotDatabase | null) { }
  async readRows(provider: UsageProvider, query: UsageHistoryQuery): Promise<HistoryResult<HistoryRow[]>> {
    if (this.db === null)
      return { ok: false, reason: 'storage_unavailable' };
    try {
      const cursor = query.after === undefined ? null : parseCursor(query.after);
      const filters = [eq(usageEvent.provider, provider)];
      if (query.from !== undefined)
        filters.push(gte(usageEvent.runAt, new Date(query.from)));
      if (query.until !== undefined)
        filters.push(lt(usageEvent.runAt, new Date(query.until)));
      if (cursor) {
        filters.push(gte(usageEvent.runAt, new Date(cursor.runAt)));
        filters.push(sql `(${usageEvent.runAt},${usageEvent.id}) > (${cursor.runAt}::timestamptz,${cursor.id}::bigint)`);
      }
      const rows = await this.db.select(fields).from(usageEvent).where(and(...filters)).orderBy(asc(usageEvent.runAt), asc(usageEvent.id)).limit(query.limit);
      return { ok: true, value: rows };
    }
    catch {
      return { ok: false, reason: 'storage_unavailable' };
    }
  }
  async readAnchorRow(provider: UsageProvider, from: string): Promise<HistoryResult<HistoryRow | null>> {
    if (this.db === null)
      return { ok: false, reason: 'storage_unavailable' };
    try {
      const rows = await this.db.select(fields).from(usageEvent).where(and(eq(usageEvent.provider, provider), eq(usageEvent.status, 'ok'), lt(usageEvent.runAt, new Date(from)))).orderBy(desc(usageEvent.runAt), desc(usageEvent.id)).limit(1);
      return { ok: true, value: rows[0] ?? null };
    }
    catch {
      return { ok: false, reason: 'storage_unavailable' };
    }
  }
  async readSummary(providers: readonly UsageProvider[]): Promise<HistoryResult<UsageHistorySummaryEntry[]>> {
    if (this.db === null)
      return { ok: false, reason: 'storage_unavailable' };
    try {
      const p = sql `p.provider`;
      const source = sql `unnest(ARRAY[${sql.join(providers.map(p => sql `${p}::text`), sql `, `)}]) WITH ORDINALITY AS p(provider, position)`;
      const rows = await this.db.select({
        provider: sql<UsageProvider> `${p}`,
        okCount: sql<number> `(SELECT count(*)::int FROM (SELECT 1 FROM usage_event e WHERE e.provider=${p} AND e.status='ok' ORDER BY e.run_at ASC LIMIT ${USAGE_HISTORY_MIN_OK_EVENTS}) x)`,
        firstOkAt: sql<string | null> `(SELECT to_char(e.run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM usage_event e WHERE e.provider=${p} AND e.status='ok' ORDER BY e.run_at ASC LIMIT 1)`,
        lastOkAt: sql<string | null> `(SELECT to_char(e.run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM usage_event e WHERE e.provider=${p} AND e.status='ok' ORDER BY e.run_at DESC LIMIT 1)`
      }).from(source).orderBy(sql `p.position`);
      return { ok: true, value: rows };
    }
    catch {
      return { ok: false, reason: 'storage_unavailable' };
    }
  }
}
