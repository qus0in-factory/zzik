import { describe, expect, it } from 'vitest'
import { createRouter } from '../../../worker/ui/router'
import { FakeStore, FakeVerifier } from '../../fakes/worker-ports'
import type { AaSnapshotRow } from '../../../worker/domain/trend/metrics/types'
import type { AaTrendStore } from '../../../worker/app/trend/get-aa-trend'

const config = { ok: true as const, config: { teamDomain: 'team', issuer: 'https://team.cloudflareaccess.com', audience: 'aud', allowedEmail: 'me@example.com' } }

class FakeAaTrendStore implements AaTrendStore {
  reads = 0
  latestDay: string | null = '2026-11-17'
  rows: AaSnapshotRow[] = [
    {
      day: '2026-11-17',
      slug: 'claude-fable-5',
      name: 'Claude Fable 5',
      creator: 'Anthropic',
      intelligenceIndex: 89,
      domains: {},
      priceIn: 3,
      priceOut: 15,
      outputTokensPerSecond: 85.4,
      timeToFirstTokenSeconds: 0.92,
      releaseDate: '2026-11-09',
      indexVersion: '5.0',
    },
  ]
  async readLatestAaDay(): Promise<string | null> {
    this.reads += 1
    return this.latestDay
  }
  async readAaSnapshot(day: string): Promise<AaSnapshotRow[]> {
    this.reads += 1
    return this.rows.filter((row) => row.day === day)
  }
}

function setup() {
  const verifier = new FakeVerifier()
  const store = new FakeStore()
  const aaTrend = new FakeAaTrendStore()
  const assets = { async fetch() { return new Response('SPA') } }
  return {
    verifier,
    aaTrend,
    app: createRouter({ config, verifier, store, aaTrend, assets }),
  }
}

describe('Given the private /api/trend/aa route', () => {
  it('When called without an Access JWT Then returns 401 without reading AA store', async () => {
    const s = setup()
    const res = await s.app.request('/api/trend/aa')
    expect(res.status).toBe(401)
    expect(s.aaTrend.reads).toBe(0)
  })

  it('When called with a valid JWT Then returns AA raw rankings with private no-store headers', async () => {
    const s = setup()
    s.verifier.result = { ok: true, claims: { email: 'me@example.com' } }
    const res = await s.app.request('/api/trend/aa', { headers: { 'Cf-Access-Jwt-Assertion': 'valid-jwt' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toMatchObject({
      day: '2026-11-17',
      indexVersion: '5.0',
      attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
      intelligenceTop: [{ slug: 'claude-fable-5', intelligenceIndex: 89, priceIn: 3, priceOut: 15, outputTokensPerSecond: 85.4, timeToFirstTokenSeconds: 0.92 }],
    })
  })

  it('When no AA snapshot exists yet Then returns 503 not_ready', async () => {
    const s = setup()
    s.verifier.result = { ok: true, claims: { email: 'me@example.com' } }
    s.aaTrend.latestDay = null
    const res = await s.app.request('/api/trend/aa', { headers: { 'Cf-Access-Jwt-Assertion': 'valid-jwt' } })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_ready' })
  })

  it('When /pub/trend/aa is requested Then returns 404 (never exposed publicly)', async () => {
    const s = setup()
    const res = await s.app.request('/pub/trend/aa')
    expect(res.status).toBe(404)
    expect(s.aaTrend.reads).toBe(0)
  })
})
