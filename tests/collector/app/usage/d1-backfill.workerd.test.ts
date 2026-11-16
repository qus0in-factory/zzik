import {readFileSync} from 'node:fs'
import {Miniflare,Log,LogLevel} from 'miniflare'
import {describe,it,expect,beforeAll,afterAll} from 'vitest'
import {runBackfill} from '../../../../collector/app/usage/d1-backfill.mjs'
import {planBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {createD1BackfillDestination} from '../../../../collector/infra/usage/d1-backfill-destination.mjs'
import {D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
import type {D1QueryPort} from '../../../../collector/domain/usage/d1-sender-types'
import type {BackfillCheckpoint,BackfillDestination} from '../../../../collector/domain/usage/d1-backfill-types'
let mf:Miniflare,db:Awaited<ReturnType<Miniflare['getD1Database']>>
beforeAll(async()=>{mf=new Miniflare({workers:[{config:{name:'backfill-local-test',compatibilityDate:'2026-11-11',env:{DB:{type:'d1',id:'backfill-local-test'}},manifest:{mainModule:'probe.mjs',modules:{'probe.mjs':{type:'esm',contents:'export default {fetch(){return new Response("ok")}}'}}}}}],log:new Log(LogLevel.NONE)});db=await mf.getD1Database('DB');for(const sql of readFileSync(new URL('../../../../worker/migrations/0001_d1_storage.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()},30000)
afterAll(async()=>{await mf.dispose()})
const source=()=>({events:['9007199254740992','9007199254740993','9007199254740994'].map(id=>({id,provider:'claude',status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope())})),snapshots:[]})
const query:D1QueryPort={authStopped:()=>false,async query(statements){try{return {ok:true,value:await db.batch(statements.map(s=>db.prepare(s.sql).bind(...s.params))) as unknown as Record<string,unknown>[]}}catch{return {ok:false,reason:'invalid',status:400,retryAfterMs:0}}}}
function checkpoint(){let saved:BackfillCheckpoint|null=null;return {read:()=>({ok:true as const,value:saved}),write:(v:BackfillCheckpoint)=>{saved=v;return {ok:true as const,value:undefined}}}}
async function reset(){await db.batch(['DELETE FROM usage_event','DELETE FROM usage_snapshot','DELETE FROM usage_write_receipt',"DELETE FROM sqlite_sequence WHERE name='usage_event'"].map(sql=>db.prepare(sql)))}
describe('Given local actual D1 and an explicit confirmed plan',()=>{
 it('When dry-running or ledger has pending rows Then performs no D1 writes',async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source(),cp=checkpoint()
  expect((await runBackfill({source:src,destination,checkpoint:cp,ledgerOutboxCount:0})).ok).toBe(true)
  expect(successValue(await destination.inspect()).events).toBe(0)
  expect(await runBackfill({source:src,destination,checkpoint:cp,ledgerOutboxCount:1})).toMatchObject({ok:false,reason:'ledger_outbox_not_empty'})
 })
 for(const failAt of [2,3])it(`When batch ${failAt} fails Then resumes from verified committed rows without duplicates`,async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source(),cp=checkpoint();let n=0
  const broken:BackfillDestination={...destination,write:async sql=>++n===failAt?{ok:false,reason:'injected_failure'}:destination.write(sql)}
  const confirmation='APPLY '+successValue(planBackfill(src)).summary.planSha256
  expect((await runBackfill({source:src,destination:broken,checkpoint:cp,ledgerOutboxCount:0,apply:true,confirmation,batchSize:1})).ok).toBe(false)
  expect(successValue(await destination.inspect()).events).toBe(failAt-1)
  expect((await runBackfill({source:src,destination,checkpoint:cp,ledgerOutboxCount:0,apply:true,confirmation,batchSize:1})).ok).toBe(true)
  expect(successValue(await destination.inspect())).toMatchObject({events:3,maxId:'9007199254740994',sequence:'9007199254740994'})
 })
 for(const point of ['middle','last'] as const)it(`When the ${point} statement fails inside a batch Then D1 rolls back earlier statements and a replay succeeds`,async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source(),cp=checkpoint(),confirmation='APPLY '+successValue(planBackfill(src)).summary.planSha256
  const broken:BackfillDestination={...destination,write:sql=>{const index=point==='middle'?2:sql.length;return destination.write([...sql.slice(0,index),{sql:'INSERT INTO usage_write_receipt(operation_id) VALUES(NULL)',params:[]},...sql.slice(index)])}}
  expect((await runBackfill({source:src,destination:broken,checkpoint:cp,ledgerOutboxCount:0,apply:true,confirmation})).ok).toBe(false)
  expect(successValue(await destination.inspect()).events).toBe(0)
  expect((await runBackfill({source:src,destination,checkpoint:cp,ledgerOutboxCount:0,apply:true,confirmation})).ok).toBe(true)
 })
 it('When an existing payload differs Then rejects before overwriting it',async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source();await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(src)).summary.planSha256});src.events[0].envelopeJson=JSON.stringify(d1Envelope({intervalSec:180}))
  expect(await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0})).toMatchObject({ok:false,reason:'migration_hash_mismatch'})
 })
 it('When receipt or snapshot writer seq exists Then refuses a backfill and an in-batch guard blocks a racing runtime writer',async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source(),confirmation='APPLY '+successValue(planBackfill(src)).summary.planSha256
  await db.prepare('INSERT INTO usage_write_receipt(operation_id,provider,write_seq,payload_sha256,created_at_ms) VALUES(?,?,?,?,?)').bind('11111111-1111-4111-8111-111111111111','claude',1,'a'.repeat(64),Date.parse(D1_NOW)).run()
  expect(await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0})).toMatchObject({ok:false,reason:'destination_not_backfill_only'})
  await reset()
  const racing:BackfillDestination={...destination,write:async sql=>{
   await db.prepare('INSERT INTO usage_snapshot(provider,envelope,status,run_at,collector_version,write_seq) VALUES(?,?,?,?,?,1)').bind('claude',JSON.stringify(d1Envelope()),'ok',Date.parse(D1_NOW),'0.6.20').run()
   return destination.write(sql)
  }}
  expect((await runBackfill({source:src,destination:racing,checkpoint:checkpoint(),ledgerOutboxCount:0,apply:true,confirmation})).ok).toBe(false)
  expect(successValue(await destination.inspect())).toMatchObject({events:0,dirtySnapshots:1})
 })
 it('When explicit large ids are backfilled Then the next default id exceeds the copied max',async()=>{
  await reset();const src=source(),destination=createD1BackfillDestination(query)
  expect((await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(src)).summary.planSha256})).ok).toBe(true)
  const next=await db.prepare('INSERT INTO usage_event(provider,run_at,status,envelope) VALUES(?,?,?,?) RETURNING CAST(id AS TEXT) AS id').bind('claude',Date.parse(D1_NOW),'ok',JSON.stringify(d1Envelope())).first<{id:string}>()
  expect(BigInt(next!.id)).toBeGreaterThan(9007199254740994n)
 })

 it('When a snapshot is copied and caught up Then keeps seq zero/op NULL and rejects an older snapshot replay',async()=>{
  await reset();const destination=createD1BackfillDestination(query),now=Date.parse(D1_NOW)
  const src=(at:string)=>({events:[],snapshots:[{id:null,provider:'claude',status:'ok',runAt:at,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope({runAt:at})),updatedAtMs:Date.parse(at)}]})
  const copy=async(source:ReturnType<typeof src>)=>runBackfill({source,destination,checkpoint:checkpoint(),ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(source)).summary.planSha256})
  expect((await copy(src(D1_NOW))).ok).toBe(true)
  const newer=new Date(now+1000).toISOString();expect((await copy(src(newer))).ok).toBe(true)
  expect(await copy(src(D1_NOW))).toMatchObject({ok:false,reason:'stale_or_conflicting_snapshot'})
  expect(await db.prepare('SELECT write_seq,operation_id FROM usage_snapshot').first()).toEqual({write_seq:0,operation_id:null})
 })
 it('When sqlite_sequence falls below existing max id Then rejects even a dry-run',async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source()
  await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(src)).summary.planSha256})
  await db.prepare("UPDATE sqlite_sequence SET seq=1 WHERE name='usage_event'").run()
  expect(await runBackfill({source:src,destination,checkpoint:checkpoint(),ledgerOutboxCount:0})).toMatchObject({ok:false,reason:'sequence_below_max_id'})
 })

 it('When the last D1 commit succeeds but checkpoint persistence fails Then verifies and skips the committed batch on restart',async()=>{
  await reset();const destination=createD1BackfillDestination(query),src=source(),cp=checkpoint();let fail=true,writes=0
  const durable={read:cp.read,write:(value:BackfillCheckpoint)=>fail?{ok:false as const,reason:'checkpoint_full'}:cp.write(value)}
  const counted:BackfillDestination={...destination,write:sql=>{writes++;return destination.write(sql)}}
  const options={source:src,destination:counted,checkpoint:durable,ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(src)).summary.planSha256}
  expect((await runBackfill(options)).ok).toBe(false);expect(successValue(await destination.inspect()).events).toBe(3)
  fail=false;expect((await runBackfill(options)).ok).toBe(true);expect(writes).toBe(1);expect(cp.read().value?.completed).toBe(3)
 })

})
