import { afterEach, describe, expect, it } from 'vitest'
import { createWorker } from '../../worker/index'
import type { Env } from '../../worker/infra/env'
import { createTestDb } from '../fakes/pglite-db'
import { usageSnapshot } from '../../shared/db/schema'
import type { UsageEnvelope } from '../../shared/usage-contract'
import type { SnapshotDatabase } from '../../worker/infra/usage/postgres-snapshot-store'

const env: Env = {
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAIL: 'owner@example.com',
  ASSETS: { async fetch() { return new Response('SPA') } },
}
const verify = () => ({ async verify() { return { ok: true as const, claims: { email: 'owner@example.com' } } } })
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); cleanup = undefined })

describe('Given the PostgreSQL-only Worker entrypoint', () => {
  it('When DB_URL exists Then reads PostgreSQL and schedules connection close with waitUntil', async () => {
    const test = await createTestDb()
    cleanup = test.close
    await test.db.insert(usageSnapshot).values({
      provider: 'claude', envelope: { schema: 1, provider: 'claude', rawText: '{}' } as UsageEnvelope,
      status: 'ok', runAt: new Date(), collectorVersion: '0.5.0',
    })
    let created = 0, closed = 0
    const worker = createWorker({ createVerifier: verify, connect: () => { created++; return { db: test.db as SnapshotDatabase, async close() { closed++ } } } })
    const pending: Promise<unknown>[] = []
    const response = await worker.fetch(new Request('https://local/api/usage/claude', { headers: { 'Cf-Access-Jwt-Assertion': 'fake' } }), { ...env, DB_URL: 'fake' }, { waitUntil: p => pending.push(p) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ snapshot: { provider: 'claude' } })
    await Promise.all(pending)
    expect(created).toBe(1)
    expect(closed).toBe(1)
    expect(pending).toHaveLength(1)
  })
  it('When DB_URL is absent Then returns 503 after valid auth instead of Access misconfiguration', async () => {
    const worker = createWorker({ createVerifier: verify })
    const response = await worker.fetch(new Request('https://local/api/usage/claude', { headers: { 'Cf-Access-Jwt-Assertion': 'fake' } }), env, { waitUntil() {} })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'storage_unavailable' })
  })
  it('When serving static assets Then allocates no DB resource', async () => {
    let connections = 0
    const worker = createWorker({ createVerifier: verify, connect: () => { connections++; throw new Error('must not connect') } })
    const response = await worker.fetch(new Request('https://local/'), { ...env, DB_URL: 'fake' }, { waitUntil() { throw Error('must not close an unused DB') } })
    expect(await response.text()).toBe('SPA')
    expect(connections).toBe(0)
  })
  it('When database reads fail Then returns sanitized 503 and still schedules cleanup', async () => {
    let closed = 0
    const pending: Promise<unknown>[] = []
    const db = { select() { throw new Error('postgres://private-connection-detail') } } as unknown as SnapshotDatabase
    const worker = createWorker({ createVerifier: verify, connect: () => ({ db, async close() { closed++; throw new Error('private-close-detail') } }) })
    const response = await worker.fetch(new Request('https://local/api/usage/claude', { headers: { 'Cf-Access-Jwt-Assertion': 'fake' } }), { ...env, DB_URL: 'fake' }, { waitUntil: p => pending.push(p) })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'storage_unavailable' })
    await expect(Promise.all(pending)).resolves.toEqual([undefined])
    expect(closed).toBe(1)
  })
  it('When router responds with an auth error Then still closes its request resource', async () => {
    let closed = 0
    const pending: Promise<unknown>[] = []
    const worker = createWorker({ createVerifier: verify, connect: () => ({ db: null, async close() { closed++ } }) })
    const response = await worker.fetch(new Request('https://local/api/usage/claude'), { ...env, DB_URL: 'fake' }, { waitUntil: p => pending.push(p) })
    expect(response.status).toBe(401)
    await Promise.all(pending)
    expect(closed).toBe(1)
  })
})

describe('Given history routes in the actual Worker composition',()=>{
 it('When local PostgreSQL is injected Then both history endpoints are wired and close their resources',async()=>{
  const test=await createTestDb();cleanup=test.close
  const pending:Promise<unknown>[]=[];let closed=0
  const worker=createWorker({createVerifier:verify,connect:()=>({db:test.db as SnapshotDatabase,async close(){closed++}})})
  for(const path of ['/api/usage-history','/api/usage-history/claude']){
   const response=await worker.fetch(new Request('https://local'+path,{headers:{'Cf-Access-Jwt-Assertion':'fake'}}),{...env,DB_URL:'local-fixture-only'},{waitUntil:p=>pending.push(p)})
   expect(response.status).toBe(200);const body=await response.json()
   if(path.endsWith('claude'))expect(body).toMatchObject({scanVersion:1,samples:[],nextCursor:null});else expect(body.summary).toHaveLength(6)
  }
  await Promise.all(pending);expect(closed).toBe(2)
 })
})
