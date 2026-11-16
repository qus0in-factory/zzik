import {fakeD1Control} from '../../../fakes/d1-control'
import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createD1Sender} from '../../../../collector/app/usage/d1-sender.mjs'
import {createD1RestClient} from '../../../../collector/infra/usage/d1-rest-client.mjs'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {buildD1WriteBatch,createCollectorD1Write} from '../../../../collector/domain/usage/d1-write-contract.mjs'
import {fakeD1RestServer} from '../../../fakes/d1-rest-server'
import {D1_NOW,D1_OPERATION_ID,d1Envelope,successValue} from '../../../fakes/d1-contract'
describe('Given real local ledger transactions and a fake atomic D1 endpoint',()=>{
 it('When terminated before local commit, after local commit or after remote commit Then sends only accepted bytes and replays without duplicate events',async()=>{
  const control=fakeD1Control()
  const directory=mkdtempSync(join(tmpdir(),'zzik-b2-')),server=fakeD1RestServer();let now=Date.parse(D1_NOW)
  let ledger=successValue(openSqliteLedger({directory,nowMs:now}))
  const query=createD1RestClient({mode:'d1',dryRun:false,control,accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>now},wait:async ms=>{now+=ms},fetch:server.fetch})
  const make=()=>createD1Sender({mode:'d1',dryRun:false,control,ledger,query,clock:{now:()=>now},random:()=>1,notice:{notify:async()=>{}},notifyAlerts:async()=>{}})
  try{
   await make().tick();expect(server.bodies).toHaveLength(0)
   successValue(ledger.update('claude',data=>acceptObservation(data,{operationId:D1_OPERATION_ID,envelope:d1Envelope(),nowMs:now,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]})))
   const accepted=successValue(ledger.read('claude')).rows[0].operation
   ledger.close();ledger=successValue(openSqliteLedger({directory,nowMs:now}))
   server.loseNextResponse();expect(await make().tick()).toMatchObject({kvOk:false})
   expect(successValue(ledger.read('claude')).state.ackedSeq).toBe(0)
   ledger.close();ledger=successValue(openSqliteLedger({directory,nowMs:now}));now+=5000
   expect(successValue(ledger.read('claude')).rows[0].operation).toEqual(accepted)
   expect(await make().tick()).toMatchObject({kvOk:true})
   expect(server.bodies[0]).toBe(server.bodies[1])
   expect(server.db.prepare('SELECT count(*) AS n FROM usage_event').get()!.n).toBe(1)
   expect(server.db.prepare('SELECT count(*) AS n FROM usage_write_receipt').get()!.n).toBe(1)
   expect(successValue(ledger.read('claude')).rows).toHaveLength(0)
  }finally{ledger.close();server.close();rmSync(directory,{recursive:true,force:true})}
 })
 it('When replay, conflicting payload, small seq or emitEvent=false is sent Then applies the final DDL contract atomically',async()=>{
  const control=fakeD1Control()
  const server=fakeD1RestServer();let now=Date.parse(D1_NOW)
  const query=createD1RestClient({mode:'d1',dryRun:false,control,accountId:'fake',databaseId:'fake',token:'fake',clock:{now:()=>now},wait:async ms=>{now+=ms},fetch:server.fetch})
  const op=(seq:number,id:string,emitEvent=true,rawText='{}')=>successValue(createCollectorD1Write({operationId:id,provider:'claude',writeSeq:seq,envelopeJson:JSON.stringify(d1Envelope({rawText})),emitEvent}))
  const send=(o:ReturnType<typeof op>)=>query.query(successValue(buildD1WriteBatch(o)))
  try{
   const high=op(2,D1_OPERATION_ID),low=op(1,'22222222-2222-4222-8222-222222222222')
   expect((await send(high)).ok).toBe(true);expect((await send(high)).ok).toBe(true);expect((await send(low)).ok).toBe(true)
   expect(server.db.prepare('SELECT write_seq FROM usage_snapshot').get()!.write_seq).toBe(2)
   expect(await send(op(2,D1_OPERATION_ID,true,'{"changed":true}'))).toMatchObject({ok:false,reason:'invalid'})
   expect(await send(op(2,'33333333-3333-4333-8333-333333333333'))).toMatchObject({ok:false,reason:'invalid'})
   expect((await send(op(3,'44444444-4444-4444-8444-444444444444',false))).ok).toBe(true)
   expect(server.db.prepare('SELECT count(*) AS n FROM usage_event').get()!.n).toBe(2)
   expect(server.db.prepare('SELECT count(*) AS n FROM usage_write_receipt').get()!.n).toBe(3)
  }finally{server.close()}
 })
})
