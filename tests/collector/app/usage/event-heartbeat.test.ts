import { describe, expect, it } from 'vitest'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { buildEnvelope } from '../../../../collector/domain/usage/envelope.mjs'
import { createPostgresEnvelopeWriter } from '../../../../collector/infra/usage/postgres-envelope-writer.mjs'
import { createTestDb } from '../../../fakes/pglite-db'
import { createFakeCollectorPorts, COLLECTOR_NOW } from '../../../fakes/collector-ports'
import ollama from '../../../fixtures/ollama-usage.normal.json'
const BODY=JSON.stringify(ollama)
const HOUR=3600000
const previous=buildEnvelope({nowMs:COLLECTOR_NOW-900000,status:'ok',called:true,httpStatus:200,retryAtMs:null,credentialExpiresAt:null,bodyText:BODY,previous:null,intervalSec:900,collectorVersion:'test',provider:'ollama'})
function ports(lastEventAt?:string|null) {
 return createFakeCollectorPorts({schema:1,provider:'ollama',previous,lastEventAt,lastRun:{status:'ok',tokenExpiresAt:null}})
}
function queue(p:ReturnType<typeof ports>,bodyText=BODY) {
 p.credentials.queueReads([{source:'local',token:'synthetic',expiresAt:null}])
 p.usage.queueUsage({ok:true,bodyText,httpStatus:200,retryAfterSec:null})
}
describe('Given unchanged successful provider usage',()=>{
 it.each([
  ['no event checkpoint',undefined,1],
  ['six hours since last event',new Date(COLLECTOR_NOW-6*HOUR).toISOString(),1],
  ['one hour since last event',new Date(COLLECTOR_NOW-HOUR).toISOString(),0],
 ] as const)('When %s Then bounds history sampling without an extra history read',async(_name,lastEventAt,expected)=>{
  const db=await createTestDb()
  try {
   const p=ports(lastEventAt), statements:string[]=[]
   const writer=createPostgresEnvelopeWriter({execute:(text:string,params?:unknown[])=>{statements.push(text);return db.client.query(text,params)}})
   let changed:boolean|undefined
   queue(p)
   const result=await runOnce({...p,store:{write:(value,meta)=>{changed=meta.changed;return writer.write(value,meta)}}},{provider:'ollama'})
   expect(result.exitCode).toBe(0)
   expect(changed).toBe(false)
   const rows=(await db.client.query<{status:string;envelope:typeof previous}>('select status,envelope from usage_event')).rows
   expect(rows).toHaveLength(expected)
   if(expected)expect(rows[0]).toMatchObject({status:'ok',envelope:{rawText:BODY}})
   expect(statements.some(s=>/^\s*SELECT/i.test(s))).toBe(false)
   expect((p.state.snapshot() as {lastEventAt:string|null}).lastEventAt).toBe(expected?new Date(COLLECTOR_NOW).toISOString():lastEventAt)
  } finally {await db.close()}
 })
 it('When only five hours 59 minutes passed Then does not refresh the event checkpoint',async()=>{
  const at=new Date(COLLECTOR_NOW-6*HOUR+1).toISOString(),p=ports(at)
  queue(p);await runOnce(p,{provider:'ollama'})
  expect((p.store.metas[0] as {heartbeat?:boolean}).heartbeat).toBe(false)
  expect((p.state.snapshot() as {lastEventAt:string}).lastEventAt).toBe(at)
 })
 it.each([null,'bad timestamp',new Date(COLLECTOR_NOW+HOUR).toISOString()])('When checkpoint %s is missing or invalid Then starts one conservative heartbeat',async at=>{
  const p=ports(at);queue(p);await runOnce(p,{provider:'ollama'})
  expect((p.store.metas[0] as {heartbeat?:boolean}).heartbeat).toBe(true)
  expect((p.state.snapshot() as {lastEventAt:string}).lastEventAt).toBe(new Date(COLLECTOR_NOW).toISOString())
 })
 it.each(['failure','throw'] as const)('When store %s occurs Then keeps lastEventAt and retries after recovery',async failure=>{
  const at=new Date(COLLECTOR_NOW-6*HOUR).toISOString(),p=ports(at)
  queue(p)
  if(failure==='failure')p.store.queueResult({ok:false,httpStatus:null,message:'SyntheticError'})
  const broken=failure==='throw'?{...p,store:{write:async()=>{throw Error('private')}}}:p
  expect((await runOnce(broken,{provider:'ollama'})).exitCode).toBe(3)
  expect((p.state.snapshot() as {lastEventAt:string}).lastEventAt).toBe(at)
  queue(p);expect((await runOnce(p,{provider:'ollama'})).exitCode).toBe(0)
  expect((p.store.metas.at(-1) as {heartbeat?:boolean}).heartbeat).toBe(true)
  expect((p.state.snapshot() as {lastEventAt:string}).lastEventAt).toBe(new Date(COLLECTOR_NOW).toISOString())
  p.clock.advance(HOUR);queue(p);await runOnce(p,{provider:'ollama'})
  expect((p.store.metas.at(-1) as {heartbeat?:boolean}).heartbeat).toBe(false)
 })
 it('When the payload changes before six hours Then records the changed event timestamp too',async()=>{
  const p=ports(new Date(COLLECTOR_NOW-HOUR).toISOString());queue(p,JSON.stringify({...ollama,synthetic:true}));await runOnce(p,{provider:'ollama'})
  expect((p.store.metas[0] as {changed:boolean}).changed).toBe(true)
  expect((p.state.snapshot() as {lastEventAt:string}).lastEventAt).toBe(new Date(COLLECTOR_NOW).toISOString())
 })
 it('When dry-running Then never stores an event or advances lastEventAt',async()=>{
  const p=ports();const old=p.state.snapshot();queue(p)
  await runOnce(p,{provider:'ollama',dryRun:true})
  expect(p.store.calls).toBe(0)
  expect(p.state.writeCount()).toBe(0)
  expect(p.state.snapshot()).toEqual(old)
 })
})
