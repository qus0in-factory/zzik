import { Hono } from 'hono';
import { USAGE_PROVIDERS } from '../../../shared/usage-contract';
import type { UsageProvider } from '../../../shared/usage-contract';
import { USAGE_BUCKET_SUFFIX, USAGE_HISTORY_ERROR_STATUS, USAGE_HISTORY_PATH } from '../../../shared/usage-history-contract';
import { getUsageHistoryBuckets, getUsageHistoryPage, getUsageHistorySummary } from '../../app/usage/get-usage-history';
import { parseHistoryBucketsQuery, parseHistoryQuery } from '../../app/usage/get-usage-history';
import type { BucketStore } from '../../domain/usage/bucket-store';
import type { HistoryStore } from '../../domain/usage/history-store';
import { respond } from '../respond';
export function createUsageHistoryRoute(store: HistoryStore, buckets: BucketStore | null = null): Hono {
  const app = new Hono({ strict: true });
  app.all('*', async (c) => {
    const path = new URL(c.req.url).pathname, rest = path.slice(USAGE_HISTORY_PATH.length);
    const bucket = rest.endsWith(`/${USAGE_BUCKET_SUFFIX}`);
    const providerPart = bucket ? rest.slice(1, -(USAGE_BUCKET_SUFFIX.length + 1)) : rest.startsWith('/') ? rest.slice(1) : null;
    const summary = rest === '';
    if (!summary && (providerPart === null || !(USAGE_PROVIDERS as readonly string[]).includes(providerPart)))
      return respond({ error: 'not_found' }, USAGE_HISTORY_ERROR_STATUS.not_found);
    if (c.req.method !== 'GET')
      return respond({ error: 'method_not_allowed' }, USAGE_HISTORY_ERROR_STATUS.method_not_allowed);
    if (summary) {
      const result = await getUsageHistorySummary(store);
      return result.ok ? respond(result.value) : respond({ error: result.reason }, 503);
    }
    const provider = providerPart as UsageProvider;
    if (bucket) {
      const parsed = parseHistoryBucketsQuery(new URL(c.req.url).searchParams);
      if (!parsed.ok)
        return respond({ error: parsed.reason }, USAGE_HISTORY_ERROR_STATUS.invalid_query);
      if (buckets === null)
        return respond({ error: 'storage_unavailable' }, 503);
      const result = await getUsageHistoryBuckets(buckets, provider, parsed.query);
      return result.ok ? respond(result.value) : respond({ error: result.reason }, 503);
    }
    const parsed = parseHistoryQuery(new URL(c.req.url).searchParams);
    if (!parsed.ok)
      return respond({ error: parsed.reason }, USAGE_HISTORY_ERROR_STATUS.invalid_query);
    const result = await getUsageHistoryPage(store, provider, parsed.query);
    return result.ok ? respond(result.value) : respond({ error: result.reason }, 503);
  });
  return app;
}
