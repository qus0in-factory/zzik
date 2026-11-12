import { describe, it, expect } from 'vitest'
import { createTestDb } from '../../../fakes/pglite-db'
import { createPostgresEnvelopeWriter } from '../../../../collector/infra/usage/postgres-envelope-writer.mjs'
const meta={provider:'claude',status:'ok',runAt:'2026-11-13T00:00:00Z',fetchedAt:null,rawSha256:'fake-hash',collectorVersion:'0.5.0',changed:true}
describe('Given migrated PostgreSQL storage', () => {
  it('When two snapshots arrive Then upserts the latest row and records only changes', async () => {
    const {client,close}=await createTestDb()
    try {
      const writer=createPostgresEnvelopeWriter({execute:(text:string,params?:unknown[])=>client.query(text,params)})
      expect(await writer.write('{"rawText":"first"}',meta)).toEqual({ok:true})
      expect(await writer.write('{"rawText":"second"}',{...meta,changed:false})).toEqual({ok:true})
      expect((await client.query('select * from usage_snapshot')).rows).toHaveLength(1)
      expect((await client.query<{envelope:{rawText:string}}>('select envelope from usage_snapshot')).rows[0].envelope.rawText).toBe('second')
      expect((await client.query('select * from usage_event')).rows).toHaveLength(1)
    } finally {await close()}
  })
  it('When the event insert fails Then rolls back the snapshot and does not leak connection details', async () => {
    const {client,close}=await createTestDb()
    try {
      const writer=createPostgresEnvelopeWriter({execute:async(text:string,params?:unknown[])=>{
        if(text.includes('INSERT INTO usage_event')) throw Object.assign(Error('postgres://secret'),{code:'23514'})
        return client.query(text,params)
      }})
      expect(await writer.write('{}',meta)).toMatchObject({ok:false,message:'23514'})
      expect((await client.query('select * from usage_snapshot')).rows).toEqual([])
    } finally {await close()}
  })
  it('When pruning Then removes only rows older than retention and returns the count', async () => {
    const {client,close}=await createTestDb()
    try {
      await client.query("insert into usage_event(provider,status,run_at,envelope) values ('claude','ok',now()-interval '31 days','{}'),('claude','ok',now()-interval '29 days','{}')")
      const writer=createPostgresEnvelopeWriter({execute:(text:string,params?:unknown[])=>client.query(text,params)})
      expect(await writer.prune(30)).toEqual({ok:true,deleted:1})
      expect((await client.query('select * from usage_event')).rows).toHaveLength(1)
    } finally {await close()}
  })
})

describe('Given unsafe database failure objects', () => {
  it('When driver messages or malformed codes contain a URL Then returns only a safe code/name', async () => {
    const writer=createPostgresEnvelopeWriter({execute:async()=>{throw {code:'postgres://secret',name:'postgres://secret',message:'postgres://secret'}}})
    expect(await writer.write('{}',meta)).toEqual({ok:false,httpStatus:null,message:'StoreError'})
    expect(await writer.prune(30)).toEqual({ok:false,message:'StoreError'})
  })
})
