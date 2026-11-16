import { USAGE_PROVIDERS } from '../../../shared/usage-contract';
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract';
import type { UsageProvider } from '../../../shared/usage-contract';
import type { UsageHistoryBucketsPage, UsageHistoryBucketsQuery, UsageHistoryPage, UsageHistoryQuery, UsageHistorySummary } from '../../../shared/usage-history-contract';
import type { BucketStore } from '../../domain/usage/bucket-store';
import type { HistoryResult, HistoryStore } from '../../domain/usage/history-store';
import { historySample } from '../../domain/usage/history-sample';
import { encodeCursor } from '../../domain/usage/history-query';
export async function getUsageHistoryPage(store: HistoryStore, provider: UsageProvider, query: UsageHistoryQuery): Promise<HistoryResult<UsageHistoryPage>> {
  const rows = await store.readRows(provider, query);
  if (!rows.ok)
    return rows;
  let anchor = null;
  if (query.anchor && query.from !== undefined) {
    const result = await store.readAnchorRow(provider, query.from);
    if (!result.ok)
      return result;
    anchor = result.value === null ? null : historySample(provider, result.value);
  }
  const samples = rows.value.map(row => historySample(provider, row)), last = samples.at(-1);
  return { ok: true, value: { provider, scanVersion: USAGE_HISTORY_SCAN_VERSION, samples, anchor, nextCursor: last ? encodeCursor(last.runAt, last.id) : query.after ?? null, hasMore: samples.length === query.limit } };
}
export async function getUsageHistorySummary(store: HistoryStore): Promise<HistoryResult<UsageHistorySummary>> {
  const result = await store.readSummary(USAGE_PROVIDERS);
  return result.ok ? { ok: true, value: { summary: result.value } } : result;
}
export async function getUsageHistoryBuckets(store: BucketStore, provider: UsageProvider, query: UsageHistoryBucketsQuery): Promise<HistoryResult<UsageHistoryBucketsPage>> {
  return store.readBuckets(provider, query);
}
export { parseHistoryQuery, parseHistoryBucketsQuery } from '../../domain/usage/history-query';
