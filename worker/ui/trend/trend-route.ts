import { Hono, type Context } from 'hono'
import { TREND_SECTIONS } from '../../../shared/trend-contract'
import type { TrendSection } from '../../../shared/trend-contract'
import { getPublicTrendSection, getTrendIndex } from '../../app/trend/get-trend'
import type { TrendStore } from '../../domain/trend/store'
import { respondPublic } from '../respond'

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600'

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { 'Cache-Control': CACHE_CONTROL, ETag: etag, 'X-Content-Type-Options': 'nosniff' } })
}

/** 공개 `/pub/trend`: 인증·사용량 저장소와 무관하게 트렌드 섹션만 읽는다. */
export function createTrendRoute(store: TrendStore | null, now: () => number = () => Date.now()) {
  const app = new Hono({ strict: true })
  const notReadyIndex = () => respondPublic({ error: 'not_ready', sections: [] }, { status: 503, noStore: true })
  const notReadySection = () => respondPublic({ error: 'not_ready' }, { status: 503, noStore: true })

  app.on(['GET', 'HEAD'], '/', async (c: Context) => {
    if (store === null) return notReadyIndex()
    try {
      const index = await getTrendIndex(store, now())
      if (index === null) return notReadyIndex()
      const body = JSON.stringify(index)
      const etag = `"${await sha256Hex(body)}"`
      if (c.req.header('If-None-Match') === etag) return notModified(etag)
      return respondPublic(index, { etag })
    } catch {
      return respondPublic({ error: 'internal_error' }, { status: 500, noStore: true })
    }
  })

  app.on(['GET', 'HEAD'], '/:section', async (c: Context) => {
    const section = c.req.param('section') ?? ''
    if (!(TREND_SECTIONS as readonly string[]).includes(section)) return respondPublic({ error: 'not_found' }, { status: 404, noStore: true })
    if (store === null) return notReadySection()
    try {
      const result = await getPublicTrendSection(store, section as TrendSection)
      if (!result.ok) {
        return result.reason === 'not_ready'
          ? notReadySection()
          : respondPublic({ error: 'internal_error' }, { status: 500, noStore: true })
      }
      // ETag는 저장 해시가 아니라 실제 응답 표현의 해시여야 조건부 요청이 정확하다.
      const body = JSON.stringify(result.payload)
      const etag = `"${await sha256Hex(body)}"`
      if (c.req.header('If-None-Match') === etag) return notModified(etag)
      return respondPublic(result.payload, { etag })
    } catch {
      return respondPublic({ error: 'internal_error' }, { status: 500, noStore: true })
    }
  })

  app.all('/', () => respondPublic({ error: 'method_not_allowed' }, { status: 405, noStore: true }))
  app.all('/:section', () => respondPublic({ error: 'method_not_allowed' }, { status: 405, noStore: true }))
  app.notFound(() => respondPublic({ error: 'not_found' }, { status: 404, noStore: true }))
  return app
}
