import { createUsageHistoryRoute } from './usage/usage-history-route'
import type { HistoryStore } from '../domain/usage/history-store'
import { Hono } from 'hono'
import { authorize } from '../app/access/authorize'
import type { AccessTokenVerifier, ConfigResult } from '../domain/access/verifier'
import type { SnapshotStore } from '../domain/usage/store'
import { respond } from './respond'
import { createUsageRoute } from './usage/usage-route'
export interface RouterDependencies {
  config: ConfigResult
  verifier: AccessTokenVerifier
  history?: HistoryStore
  store: SnapshotStore
  assets: { fetch(request: Request): Promise<Response> }
}
export function createRouter(deps: RouterDependencies) {
  const app = new Hono({ strict: true })
  app.use('*', async (c, next) => {
    // Defensive delegation for asset misses; actual Wrangler routing is verified at integration.
    if (!new URL(c.req.url).pathname.startsWith('/api/')) return deps.assets.fetch(c.req.raw)
    if (!deps.config.ok) return respond({ error: 'misconfigured' }, 500)
    const auth = await authorize(c.req.header('Cf-Access-Jwt-Assertion') ?? null, deps.verifier, deps.config.config.allowedEmail)
    if (!auth.ok) return respond({ error: auth.reason === 'unavailable' ? 'jwks_unavailable' : 'unauthorized' }, auth.reason === 'unavailable' ? 503 : 401)
    await next()
  })
  if(deps.history) app.route('/api/usage-history', createUsageHistoryRoute(deps.history))
  app.route('/api/usage', createUsageRoute(deps.store))
  app.notFound(() => respond({ error: 'not_found' }, 404))
  app.onError(() => respond({ error: 'internal_error' }, 500))
  return app
}
