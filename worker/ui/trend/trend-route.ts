import { Hono } from 'hono'
import { respondPublic } from '../respond'

export type TrendStore = unknown

/** 1단계: deps.trend가 null이면 503 not_ready(no-store)만 반환한다. */
export function createTrendRoute(trend: TrendStore | null) {
  const app = new Hono({ strict: true })
  const notReadyIndex = () => respondPublic({ error: 'not_ready', sections: [] }, { status: 503, noStore: true })
  const notReadySection = () => respondPublic({ error: 'not_ready' }, { status: 503, noStore: true })
  app.get('/', () => (trend == null ? notReadyIndex() : notReadyIndex()))
  app.get('/:section', () => (trend == null ? notReadySection() : notReadySection()))
  app.all('/', () => respondPublic({ error: 'method_not_allowed' }, { status: 405, noStore: true }))
  app.all('/:section', () => respondPublic({ error: 'method_not_allowed' }, { status: 405, noStore: true }))
  app.notFound(() => respondPublic({ error: 'not_found' }, { status: 404, noStore: true }))
  return app
}
