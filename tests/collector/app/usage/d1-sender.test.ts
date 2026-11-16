import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {describe,it,expect} from 'vitest'
import {createD1Sender} from '../../../../collector/app/usage/d1-sender.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
function setup(extra:Record<string,unknown>={}){const h=senderFixture({initialLedgerState,acceptObservation});return {...h,sender:createD1Sender({mode:'d1',dryRun:false,control:h.control,ledger:h.ledger,query:h.query,clock:h.clock,random:()=>1,notice:h.notice,notifyAlerts:h.notifyAlerts,...extra})}}
describe('Given accepted outbox operations behind an inert sender port',()=>{
 it('When PG or dry-run is active Then makes no query and never acknowledges queued data',async()=>{
  for(const x of [{mode:'postgres'},{dryRun:true}]){const h=setup(x);h.queue();expect(await h.sender.tick()).toMatchObject({kvOk:false});expect(h.calls).toHaveLength(0);expect(h.data.get('claude')!.rows).toHaveLength(1)}
 })
 it('When retried once Then sends identical statements, acks only once and delivers only fresh first-ack alerts',async()=>{
  const h=setup();h.queue();h.responses.push({ok:false,reason:'retry',status:503,retryAfterMs:0})
  expect(await h.sender.tick()).toMatchObject({kvOk:false});expect(h.alerts).toHaveLength(0)
  h.advance(5000);expect(await h.sender.tick()).toMatchObject({kvOk:true});await h.sender.tick()
  expect(h.calls[0]).toEqual(h.calls[1]);expect(h.alerts).toHaveLength(1);expect(h.data.get('claude')!.rows).toHaveLength(0)
 })
 it('When a stale operation is acknowledged Then emits no old alerts',async()=>{
  const h=setup();h.queue();h.advance(180001);expect(await h.sender.tick()).toMatchObject({kvOk:true});expect(h.alerts).toHaveLength(0)
 })
 it('When remote commits but local ack fails Then stops new collection and replay on restart uses the same operation',async()=>{
  const h=setup();h.queue();const before=structuredClone(h.data.get('claude'))
  h.failCommit(true);expect(await h.sender.tick()).toMatchObject({kvOk:false,reason:'local_commit_failed'});expect(h.sender.canCollect('claude')).toBe(false);expect(h.data.get('claude')).toEqual(before)
  h.failCommit(false)
  const restarted=createD1Sender({mode:'d1',dryRun:false,control:h.control,ledger:h.ledger,query:h.query,clock:h.clock,random:()=>1,notice:h.notice,notifyAlerts:h.notifyAlerts})
  expect(await restarted.tick()).toMatchObject({kvOk:true});expect(h.calls[0]).toEqual(h.calls[1])
 })
 it('When D1 auth fails Then stops collection and sender globally while keeping every queue',async()=>{
  for(const status of [401,403]){const h=setup();h.queue();h.queue('codex');h.responses.push({ok:false,reason:'auth',status,retryAfterMs:0});await h.sender.tick();await h.sender.tick();expect(h.calls).toHaveLength(1);expect(h.sender.canCollect('codex')).toBe(false);expect(h.notices).toHaveLength(1)}
 })
 it('When D1 rate limits Then waits globally and never changes a provider gate',async()=>{
  const h=setup();h.queue();h.queue('codex');const gate=structuredClone(h.data.get('claude')!.state.gate);h.responses.push({ok:false,reason:'retry',status:429,retryAfterMs:60000});await h.sender.tick();h.advance(59999);await h.sender.tick();expect(h.calls).toHaveLength(1);h.advance(1);await h.sender.tick();expect(h.calls).toHaveLength(2);expect(h.data.get('claude')!.state.gate).toEqual(gate)
 })
 it('When one provider returns 400 Then pauses only that queue and keeps other providers moving',async()=>{
  const h=setup();h.queue();h.queue('codex');h.responses.push({ok:false,reason:'invalid',status:400,retryAfterMs:0});await h.sender.tick();expect(h.sender.canCollect('claude')).toBe(false);expect(h.sender.canCollect('codex')).toBe(true);expect(await h.sender.tick()).toMatchObject({kvOk:true});expect(h.data.get('claude')!.rows).toHaveLength(1)
 })
 it('When the operator discards a paused 400 operation Then requires explicit receipt absence and refixes the queued successor without HTTP',async()=>{
  const h=setup();h.queue();h.queue('claude',2);h.responses.push({ok:false,reason:'invalid',status:400,retryAfterMs:0});await h.sender.tick()
  const rows=h.data.get('claude')!.rows
  expect(h.sender.discard400('claude',{}).ok).toBe(false)
  expect(h.sender.discard400('claude',{[rows[0].operation.operationId]:null,[rows[1].operation.operationId]:null}).ok).toBe(true)
  expect(h.calls).toHaveLength(1);expect(h.sender.canCollect('claude')).toBe(true)
 })
 it('When two ticks overlap Then starts only one send and rotates providers while preserving each FIFO',async()=>{
  const h=setup();h.queue();h.queue('claude',2);h.queue('codex');await Promise.all([h.sender.tick(),h.sender.tick()]);expect(h.calls).toHaveLength(1);await h.sender.tick();expect(h.data.get('codex')!.rows).toHaveLength(0);expect(h.data.get('claude')!.rows).toHaveLength(1)
 })
})
