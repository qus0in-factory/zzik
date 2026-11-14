import type { UsageProvider } from '../../../shared/usage-contract';
import type { UsageHistorySample, UsageHistoryValue } from '../../../shared/usage-history-contract';
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts';
import type { HistoryRow } from './history-store';
export function historySample(provider: UsageProvider, row: HistoryRow, scan: typeof scanUsageSeries = scanUsageSeries): UsageHistorySample {
  let values: UsageHistoryValue[] | null = null;
  let intervalSec: number | null = null;
  let fetchedAt: string | null = null;
  try {
    fetchedAt = typeof row.fetchedAt === 'string' && Number.isFinite(Date.parse(row.fetchedAt)) ? row.fetchedAt : null;
    const seconds = row.intervalSec === null ? NaN : Number(row.intervalSec);
    intervalSec = Number.isFinite(seconds) && seconds > 0 ? seconds : null;
    if (row.status === 'ok' && row.rawText !== null) {
      const raw: unknown = JSON.parse(row.rawText);
      const rawRedacted = Array.isArray(row.rawRedacted) ? row.rawRedacted.filter((p): p is string => typeof p === 'string') : [];
      const result = scan(provider, raw, { fetchedAt, rawRedacted });
      if (result.ok && (result.series.length > 0 || result.skipped === 0))
        values = result.series.map(v => ({ id: v.id, usedPercent: v.usedPercent, resetsAt: v.resetsAt, cycleSeconds: v.cycleSeconds }));
    }
  }
  catch {
    values = null;
  }
  return { id: row.id, runAt: row.runAt, status: row.status, fetchedAt, intervalSec, values };
}
