import { describe, expect, it } from 'vitest';
import { createRouter } from '../../../worker/ui/router';
import { FakeHistoryStore, FakeVerifier, FakeStore } from '../../fakes/worker-ports';
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract';
const config = { ok: true as const, config: { teamDomain: 'team.cloudflareaccess.com', issuer: 'https://team.cloudflareaccess.com', audience: 'aud', allowedEmail: 'owner@example.com' } };
function setup() { const history = new FakeHistoryStore(), verifier = new FakeVerifier(); const app = createRouter({ config, verifier, history, store: new FakeStore(), assets: { fetch: async () => new Response('SPA') } }); return { app, history, verifier }; }
const headers = { 'Cf-Access-Jwt-Assertion': 'jwt' };
describe('Given authenticated history routes', () => {
  it.each([['GET', '/api/usage-history/', 404], ['POST', '/api/usage-history/nope', 404], ['GET', '/api/usage-history/claude/more', 404], ['POST', '/api/usage-history/claude', 405], ['POST', '/api/usage-history', 405], ['GET', '/api/usage-history/claude?limit=101', 400], ['GET', '/api/usage-history/claude?from=', 400]] as const)('When %s %s Then %s without reading', async (method, path, status) => { const s = setup(), r = await s.app.request(path, { method, headers }); expect(r.status).toBe(status); expect(s.history.reads).toBe(0); expect(r.headers.get('Cache-Control')).toBe('no-store'); });
  it('When no auth or config exists Then those failures precede path and query', async () => {
    const s = setup();
    expect((await s.app.request('/api/usage-history/bad?limit=101')).status).toBe(401);
    expect(s.history.reads).toBe(0);
    const app = createRouter({ ...s, config: { ok: false, reason: 'misconfigured' }, store: new FakeStore(), assets: { fetch: async () => new Response('SPA') } });
    expect((await app.request('/api/usage-history/bad', { headers })).status).toBe(500);
    expect(s.verifier.tokens).toEqual([]);
  });
  it('When JWKS fails Then returns 503 without reading', async () => { const s = setup(); s.verifier.result = { ok: false, reason: 'unavailable' }; expect((await s.app.request('/api/usage-history', { headers })).status).toBe(503); expect(s.history.reads).toBe(0); });
  it('When summary receives arbitrary query Then ignores it and returns seven providers', async () => { const s = setup(), r = await s.app.request('/api/usage-history?limit=bad&anchor=1', { headers }); expect(r.status).toBe(200); expect((await r.json()).summary).toHaveLength(7); });
  it('When a poisoned row lies between good rows Then 200 and a usable last cursor survive', async () => {
    const s = setup(), at = '2026-11-11T12:00:00.000Z';
    s.history.rows = [1, 2, 3].map(id => ({ id: String(id), runAt: at, status: 'ok', fetchedAt: at, intervalSec: '900', rawText: id === 2 ? 'bad JSON' : '{"five_hour":{"utilization":12}}', rawRedacted: [] }));
    const r = await s.app.request('/api/usage-history/claude?limit=3', { headers });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.scanVersion).toBe(USAGE_HISTORY_SCAN_VERSION);
    expect(body.samples.map((s: any) => s.values === null)).toEqual([false, true, false]);
    expect(body.nextCursor).toBe(at + '_3');
    expect(body.hasMore).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/rawText|rawRedacted|utilization/);
  });
  it('When no samples exist Then nextCursor preserves after or is null', async () => { const s = setup(), at = '2026-11-11T12:00:00.000Z_7'; for (const [query, cursor] of [['', null], ['?after=' + at, at]] as const) {
    const r = await s.app.request('/api/usage-history/claude' + query, { headers });
    expect((await r.json()).nextCursor).toBe(cursor);
  } });
  it('When DB fails Then returns sanitized storage_unavailable', async () => { const s = setup(); s.history.unavailable = true; const r = await s.app.request('/api/usage-history/claude', { headers }); expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: 'storage_unavailable' }); });
});

import { FakeBucketStore } from '../../fakes/worker-ports'
import { USAGE_BUCKET_SEC } from '../../../shared/usage-history-contract'
const bucketHeaders = { 'Cf-Access-Jwt-Assertion': 'jwt' }
function bucketSetup() {
  const history = new FakeHistoryStore(), buckets = new FakeBucketStore(), verifier = new FakeVerifier()
  const app = createRouter({ config, verifier, history, buckets, store: new FakeStore(), assets: { fetch: async () => new Response('SPA') } })
  return { app, history, buckets }
}
const bucketQuery = 'from=2026-11-01T00:00:00.000Z&until=2026-11-16T00:00:00.000Z&bucketSec=900'
describe('Given authenticated 30-day bucket routes', () => {
  it('When /api/usage-history/:provider/buckets is requested Then it uses the bucket store and not raw history', async () => {
    const s = bucketSetup()
    s.buckets.samples = [{ id: `flat:${Date.parse('2026-11-01T00:00:00.000Z')}`, runAt: '2026-11-01T00:15:00.000Z', status: 'ok', fetchedAt: '2026-11-01T00:15:00.000Z', intervalSec: 900, values: [{ id: 'five_hour', usedPercent: 12, resetsAt: null, cycleSeconds: null }] }]
    const res = await s.app.request(`/api/usage-history/claude/buckets?${bucketQuery}`, { headers: bucketHeaders })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ provider: 'claude', bucketSec: 900, complete: true, samples: [{ values: [{ id: 'five_hour', usedPercent: 12 }] }] })
    expect(s.buckets.reads).toBe(1)
    expect(s.history.reads).toBe(0)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each([
    ['missing bucketSec', `from=2026-11-01T00:00:00.000Z&until=2026-11-16T00:00:00.000Z`],
    ['wrong bucketSec', `from=2026-11-01T00:00:00.000Z&until=2026-11-16T00:00:00.000Z&bucketSec=901`],
    ['missing from', `until=2026-11-16T00:00:00.000Z&bucketSec=900`],
    ['missing until', `from=2026-11-01T00:00:00.000Z&bucketSec=900`],
    ['until not after from', `from=2026-11-16T00:00:00.000Z&until=2026-11-16T00:00:00.000Z&bucketSec=900`],
    ['span over 30 days', `from=2026-10-01T00:00:00.000Z&until=2026-11-16T00:00:00.001Z&bucketSec=900`],
    ['invalid instant', `from=2026-02-30T00:00:00.000Z&until=2026-11-16T00:00:00.000Z&bucketSec=900`],
  ] as const)('When the query has %s Then 400 without reading', async (_name, query) => {
    const s = bucketSetup()
    const res = await s.app.request(`/api/usage-history/claude/buckets?${query}`, { headers: bucketHeaders })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_query' })
    expect(s.buckets.reads).toBe(0)
    expect(s.history.reads).toBe(0)
  })

  it.each([['GET', '/api/usage-history/nope/buckets?' + bucketQuery, 404], ['POST', '/api/usage-history/claude/buckets?' + bucketQuery, 405], ['GET', '/api/usage-history/claude/buckets/more?' + bucketQuery, 404]] as const)('When %s %s Then %s without reading', async (method, path, status) => {
    const s = bucketSetup()
    const res = await s.app.request(path, { method, headers: bucketHeaders })
    expect(res.status).toBe(status)
    expect(s.buckets.reads).toBe(0)
    expect(s.history.reads).toBe(0)
  })

  it('When the bucket store is unavailable Then 503 is sanitized', async () => {
    const s = bucketSetup()
    s.buckets.unavailable = true
    const res = await s.app.request(`/api/usage-history/claude/buckets?${bucketQuery}`, { headers: bucketHeaders })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'storage_unavailable' })
  })

  it('When no bucket store is injected Then the route is unavailable instead of falling back to raw history', async () => {
    const s = setup()
    const app = createRouter({ config, verifier: s.verifier, history: s.history, store: new FakeStore(), assets: { fetch: async () => new Response('SPA') } })
    const res = await app.request(`/api/usage-history/claude/buckets?${bucketQuery}`, { headers: bucketHeaders })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'storage_unavailable' })
    expect(s.history.reads).toBe(0)
  })

  it('When the bucket path is used Then the response is not the raw provider page', async () => {
    const s = bucketSetup()
    s.buckets.complete = false
    const res = await s.app.request(`/api/usage-history/claude/buckets?${bucketQuery}`, { headers: bucketHeaders })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ complete: false, samples: [] })
    expect(s.history.reads).toBe(0)
    expect(USAGE_BUCKET_SEC).toBe(900)
  })
})
