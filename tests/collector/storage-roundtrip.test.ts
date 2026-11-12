import { describe, it, expect } from 'vitest'
import { createTestDb } from '../fakes/pglite-db'
import { createPostgresEnvelopeWriter } from '../../collector/infra/usage/postgres-envelope-writer.mjs'
import { PostgresSnapshotStore } from '../../worker/infra/usage/postgres-snapshot-store'
import { decodeUsageSnapshot } from '../../src/domain/usage/snapshot'
import type { UsageEnvelope } from '../../shared/usage-contract'

describe('Given P1 writes and P2 reads on the migrated schema', () => {
  it('When an envelope crosses both adapters Then the public snapshot contract and raw text survive unchanged', async () => {
    const { client, db, close } = await createTestDb()
    try {
      const envelope: UsageEnvelope = {
        schema:1,provider:'antigravity',status:'ok',called:true,
        runAt:'2026-11-13T00:00:00Z',fetchedAt:'2026-11-13T00:00:00Z',
        httpStatus:200,retryAt:null,tokenExpiresAt:null,kvTokenExpiresAt:null,
        intervalSec:900,collectorVersion:'0.5.0',rawText:'{ "groups": [], "description": "[가림]" }',
        rawOmitted:null,rawRedacted:['description'],
      }
      const writer=createPostgresEnvelopeWriter({execute:(text,params)=>client.query(text,params)})
      expect(await writer.write(JSON.stringify(envelope), {
        provider:envelope.provider,status:envelope.status,runAt:envelope.runAt,
        fetchedAt:envelope.fetchedAt,rawSha256:'synthetic-hash',collectorVersion:envelope.collectorVersion,changed:true,
      })).toEqual({ok:true})
      const store=new PostgresSnapshotStore(db)
      const found=await store.read('antigravity')
      expect(found.ok).toBe(true)
      if(!found.ok || !found.value)throw Error('Expected a persisted envelope')
      expect(JSON.parse(found.value)).toEqual(envelope)
      expect(decodeUsageSnapshot({snapshot:JSON.parse(found.value)},'antigravity')).toMatchObject({
        ok:true,rawText:envelope.rawText,collection:{intervalSec:900,rawRedacted:['description']},
      })
      expect(await store.read('claude')).toEqual({ok:true,value:null})
    } finally {await close()}
  })
})
