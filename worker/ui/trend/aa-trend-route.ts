import { Hono } from 'hono'
import { getAaTrend, type AaTrendStore } from '../../app/trend/get-aa-trend'
import { respond } from '../respond'

/** Access JWT 뒤(/api/trend/aa)에서만 노출되는 AA 내부 표 엔드포인트. */
export function createAaTrendRoute(store: AaTrendStore | null) {
  const app = new Hono({ strict: true })

  app.get('/', async () => {
    if (store === null) return respond({ error: 'not_ready' }, 503)
    try {
      const result = await getAaTrend(store)
      if (!result.ok) return respond({ error: 'not_ready' }, 503)
      return new Response(JSON.stringify(result.value), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      })
    } catch {
      return respond({ error: 'internal_error' }, 500)
    }
  })

  app.all('/', () => respond({ error: 'method_not_allowed' }, 405))
  return app
}
