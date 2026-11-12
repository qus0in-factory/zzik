import { describe, it, expect } from 'vitest'
import { createRouter } from '../../../worker/ui/router'
import { FakeVerifier, FakeStore } from '../../fakes/worker-ports'
const config = { ok: true as const, config: { teamDomain: 'team.cloudflareaccess.com', issuer: 'https://team.cloudflareaccess.com', audience: 'aud', allowedEmail: 'owner@example.com' } }
function setup() {
  const verifier = new FakeVerifier(), store = new FakeStore()
  const assets = { calls: 0, async fetch() { this.calls++; return new Response('SPA') } }
  return { verifier, store, assets, app: createRouter({ config, verifier, store, assets }) }
}
describe('Given a Hono API router', () => {
  it.each([
    ['GET', '/api/usage', null, 401, 'unauthorized'],
    ['POST', '/api/usage', null, 401, 'unauthorized'],
    ['GET', '/api/nope', null, 401, 'unauthorized'],
    ['GET', '/api/nope', 'jwt', 404, 'not_found'],
    ['POST', '/api/nope', 'jwt', 404, 'not_found'],
    ['POST', '/api/usage', 'jwt', 405, 'method_not_allowed'],
    ['GET', '/api/usage/', 'jwt', 404, 'not_found'],
  ] as const)('When %s %s has token %s Then status %s and %s', async (method, path, token, status, error) => {
    const { app, store } = setup()
    const res = await app.request(path, { method, headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} })
    expect(res.status).toBe(status); expect(await res.json()).toEqual({ error }); expect(store.reads).toBe(0)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
  it('When config is invalid Then it fails before verification or storage', async () => {
    const s = setup()
    const app = createRouter({ ...s, config: { ok: false, reason: 'misconfigured' } })
    const res = await app.request('/api/nope', { method: 'POST' })
    expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: 'misconfigured' })
    expect(s.verifier.tokens).toEqual([]); expect(s.store.reads).toBe(0)
  })
  it.each(['invalid', 'unavailable'] as const)('When verification is %s Then storage is untouched', async (reason) => {
    const s = setup(); s.verifier.result = { ok: false, reason }
    const res = await s.app.request('/api/usage', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(reason === 'invalid' ? 401 : 503)
    expect(await res.json()).toEqual({ error: reason === 'invalid' ? 'unauthorized' : 'jwks_unavailable' }); expect(s.store.reads).toBe(0)
  })
  it.each([null, '{"schema":1,"provider":"claude","rawText":"unchanged"}', '{}'])('When storage returns %s for the claude alias Then it maps the use case', async (value) => {
    const s = setup(); s.store.result = { ok: true, value }
    const res = await s.app.request('/api/usage', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(value === '{}' ? 502 : 200)
    expect(await res.json()).toEqual(value === '{}' ? { error: 'snapshot_corrupt' } : { snapshot: value ? JSON.parse(value) : null })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each(['claude', 'codex', 'antigravity'])('When GET /api/usage/%s is requested Then the matching provider key is read', async (provider) => {
    const s = setup()
    const envelope = JSON.stringify({ schema: 1, provider })
    s.store.result = { ok: true, value: envelope }
    const res = await s.app.request(`/api/usage/${provider}`, { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ snapshot: JSON.parse(envelope) })
    expect(s.store.providersRead).toEqual([provider])
  })

  it('When GET /api/usage/<unknown provider> is requested Then 404 without touching storage', async () => {
    const s = setup()
    const res = await s.app.request('/api/usage/anthropic', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'not_found' }); expect(s.store.reads).toBe(0)
  })

  it('When GET /api/usage/<deep path> is requested Then 404 without touching storage', async () => {
    const s = setup()
    const res = await s.app.request('/api/usage/codex/deeper', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'not_found' }); expect(s.store.reads).toBe(0)
  })

  it('When POST /api/usage/codex is requested Then 405 (제공자 확인이 메서드보다 먼저)', async () => {
    const s = setup()
    const res = await s.app.request('/api/usage/codex', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(405); expect(await res.json()).toEqual({ error: 'method_not_allowed' }); expect(s.store.reads).toBe(0)
  })

  it('When POST /api/usage/<unknown provider> is requested Then 404 wins over 405', async () => {
    const s = setup()
    const res = await s.app.request('/api/usage/bogus', { method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(404); expect(await res.json()).toEqual({ error: 'not_found' }); expect(s.store.reads).toBe(0)
  })

  it('When the stored envelope belongs to another provider Then GET returns 502 snapshot_corrupt', async () => {
    const s = setup()
    s.store.result = { ok: true, value: JSON.stringify({ schema: 1, provider: 'codex', rawText: '{}' }) }
    const res = await s.app.request('/api/usage/claude', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(502); expect(await res.json()).toEqual({ error: 'snapshot_corrupt' })
  })

  it('When one provider key is corrupt Then the other provider path still returns 200', async () => {
    const s = setup()
    s.store.result = { ok: true, value: '{broken' }
    const corruptRes = await s.app.request('/api/usage/claude', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(corruptRes.status).toBe(502)
    s.store.result = { ok: true, value: JSON.stringify({ schema: 1, provider: 'codex' }) }
    const codexRes = await s.app.request('/api/usage/codex', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(codexRes.status).toBe(200)
  })
  it('When storage is unavailable Then it returns 503', async () => {
    const s = setup(); s.store.result = { ok: false, reason: 'storage_unavailable' }
    const res = await s.app.request('/api/usage', { headers: { 'Cf-Access-Jwt-Assertion': 'jwt' } })
    expect(res.status).toBe(503); expect(await res.json()).toEqual({ error: 'storage_unavailable' })
  })
  it.each(['/', '/any/path', '/assets/app.js'])('When requesting %s Then assets handle it without auth or storage', async (path) => {
    const s = setup(); const res = await s.app.request(path)
    expect(await res.text()).toBe('SPA'); expect(s.assets.calls).toBe(1); expect(s.verifier.tokens).toEqual([]); expect(s.store.reads).toBe(0)
  })
})

describe('Given Antigravity routing', () => {
  it('When provider case differs Then rejects before storage', async () => {
    const s=setup()
    const response=await s.app.request('/api/usage/Antigravity',{headers:{'Cf-Access-Jwt-Assertion':'jwt'}})
    expect(response.status).toBe(404)
    expect(s.store.reads).toBe(0)
  })
  it('When the stored envelope belongs to Codex Then returns 502 for Antigravity', async () => {
    const s=setup()
    s.store.result={ok:true,value:JSON.stringify({schema:1,provider:'codex'})}
    const response=await s.app.request('/api/usage/antigravity',{headers:{'Cf-Access-Jwt-Assertion':'jwt'}})
    expect(response.status).toBe(502)
  })
})
