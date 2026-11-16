import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {describe,it,expect} from 'vitest'
import {createD1Maintenance} from '../../../../collector/app/usage/d1-maintenance.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {D1_NOW} from '../../../fakes/d1-contract'
function setup(extra:Record<string,unknown>={}){const h=senderFixture({initialLedgerState,acceptObservation});return {...h,maintenance:createD1Maintenance({noticeState:h.noticeState,mode:'d1',dryRun:false,control:h.control,query:h.query,clock:h.clock,notice:h.notice,...extra})}}
describe('Given a D1-only maintenance module on the shared request lane',()=>{
 it('When postgres or dry-run is active Then never reads export state or prunes',async()=>{
  for(const x of [{mode:'postgres'},{dryRun:true}]){const h=setup(x);await h.maintenance.checkHealth();await h.maintenance.prune(D1_NOW,30);expect(h.calls).toHaveLength(0);expect(h.notices).toHaveLength(0)}
 })
 it('When export is older than 36h, checkpoint stalls or read fails Then emits a safe notice and reads at most daily',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)-36*3600000-1}]},{results:[{provider:'codex',stalled_at_ms:1}]}]});await h.maintenance.checkHealth();await h.maintenance.checkHealth();expect(h.calls).toHaveLength(1);expect(h.notices).toHaveLength(2)
  h.advance(86400000);h.responses.push({ok:false,reason:'retry',status:503,retryAfterMs:0});await h.maintenance.checkHealth();expect(h.calls).toHaveLength(2);expect(h.notices).toHaveLength(3)
 })
 it('When export and checkpoints are healthy Then sends no warning',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]});expect((await h.maintenance.checkHealth()).ok).toBe(true);expect(h.notices).toHaveLength(0)
 })
 it('When maintenance restarts Then preserves the daily health-read checkpoint',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]});await h.maintenance.checkHealth()
  const restarted=createD1Maintenance({noticeState:h.noticeState,mode:'d1',dryRun:false,control:h.control,query:h.query,clock:h.clock,notice:h.notice})
  await restarted.checkHealth();expect(h.calls).toHaveLength(1)
 })
it('When quiesce cancels a queued health read Then sends no outage alert and preserves the previous health checkpoint',async()=>{
  const h=setup();h.responses.push({ok:false,reason:'disabled',status:null,retryAfterMs:0});await h.maintenance.checkHealth()
  expect(h.notices).toHaveLength(0);const saved=h.control.read();expect(saved.ok&&saved.value.lastHealthCheckAtMs).toBeNull()
 })
 it('When the REST client advances nextRequestAtMs during the health query Then recording the checkpoint preserves it',async()=>{
  const h=setup()
  const advanced=Date.parse(D1_NOW)+4242
  const originalQuery=h.query
  const racingQuery={authStopped:()=>false,async query(statements:unknown){
   const result=await originalQuery.query(statements)
   const current=h.control.read();if(!current.ok)throw new Error('control read failed')
   h.control.write({...current.value,nextRequestAtMs:advanced})
   return result
  }}
  const maintenance=createD1Maintenance({noticeState:h.noticeState,mode:'d1',dryRun:false,control:h.control,query:racingQuery,clock:h.clock,notice:h.notice})
  h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]})
  expect((await maintenance.checkHealth()).ok).toBe(true)
  expect(h.control.read()).toMatchObject({ok:true,value:{lastHealthCheckAtMs:Date.parse(D1_NOW),nextRequestAtMs:advanced}})
 })
 it('When health read fails Then does not advance checkpoint and retries on the next cycle',async()=>{
  const h=setup()
  h.responses.push({ok:false,reason:'retry',status:503,retryAfterMs:0})
  expect(await h.maintenance.checkHealth()).toMatchObject({ok:false,reason:'retry'})
  expect(h.control.read()).toMatchObject({ok:true,value:{lastHealthCheckAtMs:null}})
  expect(h.notices).toHaveLength(1)

  h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]})
  expect(await h.maintenance.checkHealth()).toMatchObject({ok:true})
  expect(h.calls).toHaveLength(2)
  expect(h.control.read()).toMatchObject({ok:true,value:{lastHealthCheckAtMs:Date.parse(D1_NOW)}})
 })
 it('When pruning Then uses separate provider-specific 500-row event, boundary and receipt batches without touching checkpoints',async()=>{
  const h=setup();for(let i=0;i<18;i++)h.responses.push({ok:true,value:[{meta:{changes:0}}]})
  expect(await h.maintenance.prune('2026-11-14T00:00:00Z',30)).toMatchObject({ok:true,lastPruneAt:D1_NOW})
  expect(h.calls).toHaveLength(18)
  const sqls=h.calls.flatMap(call=>(call as {sql:string}[]).map(s=>s.sql))
  expect(sqls.filter(sql=>sql.includes('DELETE FROM usage_event'))).toHaveLength(6)
  expect(sqls.filter(sql=>sql.includes('DELETE FROM usage_bucket_boundary'))).toHaveLength(6)
  expect(sqls.filter(sql=>sql.includes('DELETE FROM usage_write_receipt'))).toHaveLength(6)
  for(const call of h.calls){
   const statements=call as {sql:string;params?:unknown[]}[]
   expect(statements).toHaveLength(1)
   expect(statements[0].sql).toContain('LIMIT 500')
   expect(statements[0].sql).not.toContain('INSERT')
   expect(statements[0].sql).not.toContain('usage_bucket_checkpoint')
  }
  const eventCall=(h.calls[0] as {sql:string;params:unknown[]}[])[0]
  const boundaryCall=(h.calls[1] as {sql:string;params:unknown[]}[])[0]
  expect(boundaryCall.sql).toContain('WHERE rowid IN (SELECT rowid FROM usage_bucket_boundary WHERE provider=? AND run_at_ms<? LIMIT 500)')
  expect(boundaryCall.params).toEqual(eventCall.params)
  const fail=setup();fail.responses.push({ok:false,reason:'retry',status:500,retryAfterMs:0});expect(await fail.maintenance.prune('2026-11-14T00:00:00Z',30)).toMatchObject({ok:false,lastPruneAt:'2026-11-14T00:00:00Z'})
 })
 it('When lastPruneAt is unknown Then reports and skips immediate deletion',async()=>{
  const h=setup();expect(await h.maintenance.prune(null,30)).toMatchObject({ok:false,reason:'prune_time_unknown'});expect(h.calls).toHaveLength(0);expect(h.notices).toHaveLength(1)
 })
 it('When control re-read fails right before writing the health checkpoint Then emits sender_control_failed without writing',async()=>{
  const h=setup()
  let reads=0,writes=0
  const control={
   read:()=>{reads+=1;return reads===1?h.control.read():{ok:false as const,reason:'control_corrupt'}},
   write:(next:Parameters<typeof h.control.write>[0])=>{writes+=1;return h.control.write(next)},
  }
  const maintenance=createD1Maintenance({noticeState:h.noticeState,mode:'d1',dryRun:false,control,query:h.query,clock:h.clock,notice:h.notice})
  h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]})
  expect(await maintenance.checkHealth()).toMatchObject({ok:false,reason:'control_corrupt'})
  expect(writes).toBe(0)
  expect(h.notices).toEqual([{reason:'sender_control_failed'}])
 })
 it('When control stays broken across repeated calls Then throttles the same notice reason to once per 24 hours',async()=>{
  const h=setup()
  const control={read:()=>({ok:false as const,reason:'control_corrupt'}),write:h.control.write}
  const maintenance=createD1Maintenance({noticeState:h.noticeState,mode:'d1',dryRun:false,control,query:h.query,clock:h.clock,notice:h.notice})
  await maintenance.checkHealth()
  await maintenance.checkHealth()
  expect(h.notices).toEqual([{reason:'sender_control_failed'}])
  h.advance(86400000-1)
  await maintenance.checkHealth()
  expect(h.notices).toHaveLength(1)
  h.advance(1)
  await maintenance.checkHealth()
  expect(h.notices).toHaveLength(2)
 })
})
