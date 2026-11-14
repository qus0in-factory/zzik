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
  it('When summary receives arbitrary query Then ignores it and returns six providers', async () => { const s = setup(), r = await s.app.request('/api/usage-history?limit=bad&anchor=1', { headers }); expect(r.status).toBe(200); expect((await r.json()).summary).toHaveLength(6); });
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
