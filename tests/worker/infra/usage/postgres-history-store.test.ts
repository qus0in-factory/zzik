import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../../../fakes/pglite-db';
import { usageEvent } from '../../../../shared/db/schema';
import { PostgresHistoryStore } from '../../../../worker/infra/usage/postgres-history-store';
import { getUsageHistoryPage, getUsageHistorySummary } from '../../../../worker/app/usage/get-usage-history';
import type { UsageEnvelope } from '../../../../shared/usage-contract';
import type { SnapshotDatabase } from '../../../../worker/infra/usage/postgres-snapshot-store';
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
describe('Given local PostgreSQL history', () => {
  it('When paginating tied times Then no row is skipped; bounds, anchors and poison rows use column time', async () => {
    const t = await createTestDb();
    close = t.close;
    for (const [i, status] of ['ok', 'network_error', 'ok', 'ok', 'ok'].entries())
      await t.db.insert(usageEvent).values({ provider: 'claude', status, runAt: new Date(i < 3 ? '2026-11-11T12:00:00Z' : `2026-11-11T${i + 10}:00:00Z`), envelope: { fetchedAt: '2026-11-11T12:00:00Z', intervalSec: 900, rawText: i === 2 ? 'bad JSON' : '{"five_hour":{"utilization":10}}' } as UsageEnvelope });
    const store = new PostgresHistoryStore(t.db as SnapshotDatabase);
    const first = await getUsageHistoryPage(store, 'claude', { limit: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok)
      return;
    expect(first.value.samples.map(s => s.id)).toEqual(['1', '2']);
    expect(first.value.samples[1].values).toBeNull();
    expect(first.value.nextCursor).toBe('2026-11-11T12:00:00.000Z_2');
    const second = await getUsageHistoryPage(store, 'claude', { limit: 2, after: first.value.nextCursor! });
    if (!second.ok)
      throw Error();
    expect(second.value.samples.map(s => s.id)).toEqual(['3', '4']);
    expect(second.value.samples[0].values).toBeNull();
    const failed = await store.readRows('claude', { limit: 2 });
    if (!failed.ok)
      throw Error();
    expect(failed.value[1].rawText).toBeNull();
    expect(failed.value[1].rawRedacted).toBeNull();
    const bounded = await getUsageHistoryPage(store, 'claude', { limit: 50, from: '2026-11-11T13:00:00Z', until: '2026-11-11T14:00:00Z', anchor: true });
    if (!bounded.ok)
      throw Error();
    expect(bounded.value.samples.map(s => s.id)).toEqual(['4']);
    expect(bounded.value.anchor?.id).toBe('3');
    expect(bounded.value.anchor?.values).toBeNull();
    const noAnchor = await getUsageHistoryPage(store, 'claude', { limit: 50, from: '2020-01-01T00:00:00Z', anchor: true });
    if (!noAnchor.ok)
      throw Error();
    expect(noAnchor.value.anchor).toBeNull();
  });
  it('When summarizing Then counts only four ok rows without reading envelope and preserves provider order', async () => {
    const t = await createTestDb();
    close = t.close;
    for (let i = 0; i < 7; i++)
      await t.db.insert(usageEvent).values({ provider: 'claude', runAt: new Date(`2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`), status: i === 0 ? 'network_error' : 'ok', envelope: {} as UsageEnvelope });
    const result = await getUsageHistorySummary(new PostgresHistoryStore(t.db as SnapshotDatabase));
    if (!result.ok)
      throw Error();
    expect(result.value.summary.map(s => s.provider)).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama']);
    expect(result.value.summary[0]).toEqual({ provider: 'claude', okCount: 4, firstOkAt: '2026-11-02T00:00:00.000Z', lastOkAt: '2026-11-07T00:00:00.000Z' });
    expect(result.value.summary[1]).toEqual({ provider: 'codex', okCount: 0, firstOkAt: null, lastOkAt: null });
  });
  it('When storage is absent or throws Then all methods return unavailable', async () => { for (const db of [null, { select() { throw Error('private'); } } as unknown as SnapshotDatabase]) {
    const store = new PostgresHistoryStore(db);
    expect(await store.readRows('claude', { limit: 50 })).toEqual({ ok: false, reason: 'storage_unavailable' });
    expect(await store.readAnchorRow('claude', '2026-11-11T00:00:00Z')).toEqual({ ok: false, reason: 'storage_unavailable' });
    expect(await store.readSummary(['claude'])).toEqual({ ok: false, reason: 'storage_unavailable' });
  } });
});
