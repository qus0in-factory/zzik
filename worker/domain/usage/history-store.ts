import type { UsageProvider, UsageStatus } from '../../../shared/usage-contract';
import type { UsageHistoryQuery, UsageHistorySummaryEntry } from '../../../shared/usage-history-contract';
export interface HistoryRow {
  id: string;
  runAt: string;
  status: UsageStatus;
  fetchedAt: string | null;
  intervalSec: string | null;
  rawText: string | null;
  rawRedacted: unknown;
}
export type HistoryResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  reason: 'storage_unavailable';
};
export interface HistoryStore {
  readRows(provider: UsageProvider, query: UsageHistoryQuery): Promise<HistoryResult<HistoryRow[]>>;
  readAnchorRow(provider: UsageProvider, from: string): Promise<HistoryResult<HistoryRow | null>>;
  readSummary(providers: readonly UsageProvider[]): Promise<HistoryResult<UsageHistorySummaryEntry[]>>;
}
