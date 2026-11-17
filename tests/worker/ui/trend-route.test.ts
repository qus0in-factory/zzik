import { describe, expect, it } from 'vitest'
import type { TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'
import { TREND_METRICS_RULE } from '../../../shared/trend-contract'
import type { TrendSectionRow, TrendSourceStateRow, TrendStore } from '../../../worker/domain/trend/store'
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
const metricsPayload: TrendSectionPayload = {
  section: 'metrics',
  schemaVersion: 1,
  generatedAt: '2026-11-17T05:00:00.000Z',
  rule: TREND_METRICS_RULE,
  sources: [{ id: 'openrouter-rankings', fetchedAt: '2026-11-17T05:00:00.000Z', status: 'ok' }],
  items: [],
  blocks: [
    {
      id: 'or-usage', status: 'ok', asOf: '2026-11-17T04:00:00Z', asOfKind: 'source',
      entries: [], attribution: 'Source: OpenRouter (openrouter.ai/rankings), as of 2026-11-17T04:00:00Z. Licensed under CC BY 4.0.',
      license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, processed: true,
    },
  ],
}
const sha = 'a'.repeat(64)

class FakeTrendStore implements TrendStore {
  reads = 0
  stored = JSON.stringify(payload)
  metricsStored = JSON.stringify(metricsPayload)
  async readSection(section: TrendSection): Promise<TrendSectionRow | null> {
    this.reads += 1
    if (section === 'new-models') return { section, payload: this.stored, payloadSha256: sha, generatedAt: Date.parse(payload.generatedAt) }
    if (section === 'metrics') return { section, payload: this.metricsStored, payloadSha256: sha, generatedAt: Date.parse(metricsPayload.generatedAt) }
    return null
  }
  async readSections(): Promise<TrendSectionRow[]> {
    this.reads += 1
    return [
      { section: 'new-models', payload: this.stored, payloadSha256: sha, generatedAt: Date.parse(payload.generatedAt) },
      { section: 'metrics', payload: this.metricsStored, payloadSha256: sha, generatedAt: Date.parse(metricsPayload.generatedAt) },
    ]
  }
  async writeSection(_payload: TrendSectionPayload): Promise<string> { return sha }
  async readSourceState(_source: string): Promise<TrendSourceStateRow | null> { return null }
  async writeSourceState(_row: TrendSourceStateRow): Promise<void> {}
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
    expect((await res.json() as { sections: unknown[] }).sections).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'new-models', count: 1, status: 'ok' })]))
    expect(s.verifier.tokens).toEqual([])
    expect(s.store.reads).toBe(0)
    expect(s.assets.calls).toBe(0)
  })

  it('When GET /pub/trend/new-models Then returns the section with cache and ETag; If-None-Match gets 304', async () => {
    const s = setup()
    const first = await s.app.request('/pub/trend/new-models')
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    const etag = first.headers.get('ETag')!
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    expect(await first.json()).toMatchObject({ section: 'new-models', items: [{ id: 'anthropic/claude-x' }] })
    const second = await s.app.request('/pub/trend/new-models', { headers: { 'If-None-Match': etag } })
    expect(second.status).toBe(304)
    expect(await second.text()).toBe('')
    expect(second.headers.get('ETag')).toBe(etag)
  })

  it('When the stored payload has extra/internal fields Then the public body contains only contract fields', async () => {
    const s = setup()
    const stored = {
      ...payload,
      internal: 'sentinel-top-secret',
      items: [{ ...payload.items[0], extra: { firstSeenAt: 1, releaseMs: 2 }, secret: 'sentinel-item' }],
    }
    ;(s.trend as unknown as { stored: string }).stored = JSON.stringify(stored)
    const res = await s.app.request('/pub/trend/new-models')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('sentinel')
    expect(text).not.toContain('extra')
    expect(text).not.toContain('firstSeenAt')
    expect(JSON.parse(text)).toEqual(payload)
  })

  it('When the stored payload violates the contract Then returns a fixed 500 without echoing the payload', async () => {
    const s = setup()
    ;(s.trend as unknown as { stored: string }).stored = JSON.stringify({ ...payload, items: [{ id: 'x' }], secret: 'sentinel' })
    const res = await s.app.request('/pub/trend/new-models')
    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'internal_error' })
  })

  it('When a legacy stored metrics payload has an AA block Then the public projection returns only OpenRouter', async () => {
    const s = setup()
    const legacy = {
      ...metricsPayload,
      blocks: [
        {
          id: 'aa-intelligence', status: 'ok', asOf: '2026-11-17', version: '3.0',
          entries: [{ id: 'a/x', name: 'A X', creator: 'A', rank: 1, rankDelta: null, kind: 'steady', index: 90 }],
          attribution: 'Artificial Analysis — artificialanalysis.ai (Intelligence Index v3.0, 2026-11-17)',
        },
        ...metricsPayload.blocks!,
      ],
    }
    ;(s.trend as unknown as { metricsStored: string }).metricsStored = JSON.stringify(legacy)
    const res = await s.app.request('/pub/trend/metrics')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('aa-intelligence')
    expect(text).not.toContain('\"index\":90')
    const body = JSON.parse(text) as { blocks: Array<{ id: string }> }
    expect(body.blocks.map((block) => block.id)).toEqual(['or-usage'])
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
