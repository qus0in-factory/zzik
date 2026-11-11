import { Hono } from 'hono'
import { getUsage } from '../../app/usage/get-usage'
import type { SnapshotStore } from '../../domain/usage/store'
import { respond } from '../respond'
export function createUsageRoute(store: SnapshotStore) {
  const app = new Hono()
  app.all('/', async (c) => {
    if (c.req.method !== 'GET') return respond({ error: 'method_not_allowed' }, 405)
    const result = await getUsage(store)
    return result.ok ? respond({ snapshot: result.snapshot }) : respond({ error: result.reason }, result.reason === 'snapshot_corrupt' ? 502 : 503)
  })
  return app
}
