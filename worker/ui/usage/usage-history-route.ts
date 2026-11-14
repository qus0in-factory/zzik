import { Hono } from 'hono';
import { USAGE_PROVIDERS } from '../../../shared/usage-contract';
import type { UsageProvider } from '../../../shared/usage-contract';
import { USAGE_HISTORY_ERROR_STATUS, USAGE_HISTORY_PATH } from '../../../shared/usage-history-contract';
import { getUsageHistoryPage, getUsageHistorySummary } from '../../app/usage/get-usage-history';
import { parseHistoryQuery } from '../../app/usage/get-usage-history';
import type { HistoryStore } from '../../domain/usage/history-store';
import { respond } from '../respond';
export function createUsageHistoryRoute(store: HistoryStore): Hono {
  const app = new Hono({ strict: true });
  app.all('*', async (c) => {
    const path = new URL(c.req.url).pathname, rest = path.slice(USAGE_HISTORY_PATH.length);
    const provider = rest.startsWith('/') ? rest.slice(1) : null;
    const summary = rest === '';
    if (!summary && (provider === null || !(USAGE_PROVIDERS as readonly string[]).includes(provider)))
      return respond({ error: 'not_found' }, USAGE_HISTORY_ERROR_STATUS.not_found);
    if (c.req.method !== 'GET')
      return respond({ error: 'method_not_allowed' }, USAGE_HISTORY_ERROR_STATUS.method_not_allowed);
    if (summary) {
      const result = await getUsageHistorySummary(store);
      return result.ok ? respond(result.value) : respond({ error: result.reason }, 503);
    }
    const parsed = parseHistoryQuery(new URL(c.req.url).searchParams);
    if (!parsed.ok)
      return respond({ error: parsed.reason }, USAGE_HISTORY_ERROR_STATUS.invalid_query);
    const result = await getUsageHistoryPage(store, provider as UsageProvider, parsed.query);
    return result.ok ? respond(result.value) : respond({ error: result.reason }, 503);
  });
  return app;
}
