import { describe, expect, it } from 'vitest'
import type { TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import type { TrendSectionRow, TrendSeenRow, TrendSourceStateRow, TrendStore } from '../../../worker/domain/trend/store'
import { createRouter } from '../../../worker/ui/router'
import { FakeStore, FakeVerifier } from '../../fakes/worker-ports'

const config = { ok: true as const, config: { teamDomain: 'team.cloudflareaccess.com', issuer: 'https://team.cloudflareaccess.com', audience: 'aud', allowedEmail: 'owner@example.com' } }
const payload: TrendSectionPayload = {
  section: 'new-models',
  schemaVersion: 1,
  generatedAt: '2026-11-17T00:00:00.000Z',
  rule: 'release-or-first-seen-7d',
  sources: [{ id: 'models.dev', fetchedAt: '2026-11-17T00:00:00.000Z', status: 'ok' }],
  items: [{ id: 'anthropic/claude-x', name: 'Claude X', creator: 'anthropic', releaseDate: '2026-11-16', precision: 'day', price: { input: 3, output: 15 }, free: false, openWeights: false, providers: ['anthropic'], links: {} }],
}
const sha = 'a'.repeat(64)

class FakeTrendStore implements TrendStore {
  reads = 0
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> {
    this.reads += 1
    return section === 'new-models' ? { section, payload: JSON.stringify(payload), payloadSha256: sha, generatedAt: Date.parse(payload.generatedAt) } : null
  }
  async readSections(): Promise<TrendSectionRow[]> {
    this.reads += 1
    return [{ section: 'new-models', payload: JSON.stringify(payload), payloadSha256: sha, generatedAt: Date.parse(payload.generatedAt) }]
  }
  async writeSection(_payload: TrendSectionPayload): Promise<string> { return sha }
  async readSourceState(_source: string): Promise<TrendSourceStateRow | null> { return null }
  async writeSourceState(_row: TrendSourceStateRow): Promise<void> {}
  async readSeen(): Promise<TrendSeenRow[]> { return [] }
  async upsertSeen(_rows: readonly TrendSeenRow[]): Promise<void> {}
}

function setup() {
  const verifier = new FakeVerifier(), store = new FakeStore(), assets = { calls: 0, async fetch() { this.calls++; return new Response('SPA') } }
  const trend = new FakeTrendStore()
  return { verifier, store, assets, trend, app: createRouter({ config, verifier, store, trend, assets }) }
}

describe('Given public trend routes with a ready D1 store', () => {
  it('When GET /pub/trend Then returns the index with public cache headers and no auth', async () => {
    const s = setup()
    const res = await s.app.request('/pub/trend')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('ETag')).toMatch(/^".+"$/)
    expect(await res.json()).toMatchObject({ sections: [{ id: 'new-models', count: 1, status: 'ok' }] })
    expect(s.verifier.tokens).toEqual([])
    expect(s.store.reads).toBe(0)
    expect(s.assets.calls).toBe(0)
  })

  it('When GET /pub/trend/new-models Then returns the section with cache and ETag; If-None-Match gets 304', async () => {
    const s = setup()
    const first = await s.app.request('/pub/trend/new-models')
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    expect(first.headers.get('ETag')).toBe(`"${sha}"`)
    expect(await first.json()).toMatchObject({ section: 'new-models', items: [{ id: 'anthropic/claude-x' }] })
    const second = await s.app.request('/pub/trend/new-models', { headers: { 'If-None-Match': `"${sha}"` } })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
    expect(second.headers.get('ETag')).toBe(`"${sha}"`)
  })

  it('When a valid section has no row Then 503 no-store; unknown section 404; POST 405; deep path 404', async () => {
    const s = setup()
    const noRow = await s.app.request('/pub/trend/free-models')
    expect(noRow.status).toBe(503)
    expect(await noRow.json()).toEqual({ error: 'not_ready' })
    expect(noRow.headers.get('Cache-Control')).toBe('no-store')
    const unknown = await s.app.request('/pub/trend/unknown')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'not_found' })
    const post = await s.app.request('/pub/trend/new-models', { method: 'POST' })
    expect(post.status).toBe(405)
    const deep = await s.app.request('/pub/trend/new-models/deeper')
    expect(deep.status).toBe(404)
    expect(s.verifier.tokens).toEqual([])
    expect(s.store.reads).toBe(0)
  })
})
