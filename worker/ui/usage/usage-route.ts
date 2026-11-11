import { getUsage } from '../../app/usage/get-usage'
import type { SnapshotStore } from '../../domain/usage/store'
import { Hono, type Context } from 'hono'
import { USAGE_PROVIDERS } from '../../../shared/usage-contract'
import { respond } from '../respond'

/**
 * 제공자별 조회 경로(ADR 0.3 D7). 판정 순서는 설정 → 인증 → 경로(제공자 확인 포함) →
 * 메서드 → 저장소다. /api/usage는 claude의 별칭(0.3 동안 유지, 다음 버전에서 삭제).
 * KV 키는 domain(app)의 표에서 고른다 — 요청 문자열로 조립하지 않는다.
 */
export function createUsageRoute(store: SnapshotStore): Hono {
  const app = new Hono()

  const handle = async (c: Context, provider: string) => {
    if (provider === '' || !(USAGE_PROVIDERS as readonly string[]).includes(provider)) {
      return respond({ error: 'not_found' }, 404)
    }
    if (c.req.method !== 'GET') return respond({ error: 'method_not_allowed' }, 405)
    const result = await getUsage(store, provider as Parameters<typeof getUsage>[1])
    return result.ok
      ? respond({ snapshot: result.snapshot })
      : respond({ error: result.reason }, result.reason === 'snapshot_corrupt' ? 502 : 503)
  }

  app.get('/', (c: Context) => handle(c, 'claude'))
  app.get('/:provider', (c: Context) => handle(c, c.req.param('provider') ?? ''))
  app.all('*', (c: Context) => {
    // 제공자 확인이 메서드보다 먼저다: 유효 제공자(또는 별칭)에 대한 다른 메서드는 405,
    // 트레일링 슬래시·목록에 없는 제공자·깊은 경로는 404다. 어떤 경우에도 저장소를 읽지 않는다.
    const path = new URL(c.req.url).pathname
    const rest = path.replace(/^\/api\/usage\/?/, '')
    if (rest.includes('/')) return respond({ error: 'not_found' }, 404)
    const candidate = rest.split('/')[0] ?? ''
    if (candidate === '' && c.req.method !== 'GET') return respond({ error: 'method_not_allowed' }, 405)
    if ((USAGE_PROVIDERS as readonly string[]).includes(candidate)) {
      return respond({ error: 'method_not_allowed' }, 405)
    }
    return respond({ error: 'not_found' }, 404)
  })
  return app
}
