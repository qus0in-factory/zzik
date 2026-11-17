import {describe,it,expect} from 'vitest'
import {createProviderScheduler} from '../../../../collector/app/usage/provider-scheduler.mjs'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {successValue} from '../../../fakes/d1-contract'
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
function setup(mode:'d1'='d1'){
 const h=senderFixture({initialLedgerState,acceptObservation});const calls:string[]=[];const release:Array<()=>void>=[]
 const scheduler=createProviderScheduler({mode,ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:['claude','codex','antigravity'].map(id=>({id:id as 'claude'|'codex'|'antigravity',intervalSec:900,run:async({markStarted}:{markStarted:()=>boolean})=>{if(!markStarted())return;calls.push(id);await new Promise<void>(r=>release.push(r))}}))})
 return {...h,scheduler,calls,release}
}
describe('Given provider due times and upstream-start checkpoints',()=>{
 it('When D1 ticks overlap Then runs at most two providers and one instance of each',async()=>{
  const h=setup();h.scheduler.pump();h.scheduler.pump();expect(h.calls).toEqual(['claude','codex']);h.release.shift()!();await flush();h.scheduler.pump();expect(h.calls).toEqual(['claude','codex','antigravity']);h.release.splice(0).forEach(r=>r());await flush()
 })
 it('When a local gate tick skips upstream Then nextDue advances without changing lastStartedAt',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let calls=0
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:900,run:async()=>{calls++}}]})
  scheduler.pump();await flush();expect(calls).toBe(1);expect(successValue(h.ledger.read('claude')).state).toMatchObject({lastStartedAtMs:null,nextDueMs:h.clock.now()+900000})
 })
 it('When returning from sleep Then runs each provider once at current time instead of replaying missed ticks',async()=>{
  const h=setup();h.scheduler.pump();h.release.splice(0).forEach(r=>r());await flush();h.advance(86400000);h.scheduler.pump();expect(h.calls.filter(p=>p==='claude')).toHaveLength(2);h.release.splice(0).forEach(r=>r());await flush()
 })
 it('When Antigravity remains active Then never launches a second CLI, even after overdue ticks',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let calls=0,release!:()=>void
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'antigravity',intervalSec:900,run:async({markStarted})=>{markStarted();calls++;await new Promise<void>(r=>{release=r})}}]})
  scheduler.pump();h.advance(86400000);scheduler.pump();scheduler.pump();expect(calls).toBe(1);release();await flush()
 })
 it('When three consecutive clock-skew samples arrive Then stops only that provider',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let skew=0,other=0
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:900,run:async()=>{skew++;return {reason:'clock_skew'}}},{id:'codex',intervalSec:900,run:async()=>{other++}}]})
  for(let i=0;i<4;i++){scheduler.pump();await flush();h.advance(900000)}
  expect(skew).toBe(3);expect(other).toBe(4);expect(successValue(h.ledger.read('claude')).state.clockStopped).toBe(true);expect(h.notices).toContainEqual({reason:'clock_skew_stopped',provider:'claude'})
 })
 it('When stopped Then never starts another provider and exposes current work for quiesce',async()=>{
  const h=setup();h.scheduler.pump();h.scheduler.stop();expect(h.scheduler.pending()).toHaveLength(2);h.release.splice(0).forEach(r=>r());await flush();h.scheduler.pump();expect(h.calls).toHaveLength(2)
 })
 it('When a provider reports queue_limit Then notifies and another provider still starts',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});const calls:string[]=[]
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[
   {id:'claude',intervalSec:900,run:async()=>{calls.push('claude');return {reason:'queue_limit'}}},
   {id:'codex',intervalSec:900,run:async()=>{calls.push('codex')}},
  ]})
  scheduler.pump();await flush()
  expect(h.notices).toContainEqual({reason:'queue_limit',provider:'claude'})
  expect(calls).toContain('codex')
 })
 it('When one provider throws Then only that provider is isolated and another provider still starts',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});const calls:string[]=[]
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[
   {id:'claude',intervalSec:900,run:async()=>{calls.push('claude');throw new Error('provider boom')}},
   {id:'codex',intervalSec:900,run:async()=>{calls.push('codex')}},
   {id:'antigravity',intervalSec:900,run:async()=>{calls.push('antigravity')}},
  ]})
  scheduler.pump();await flush();scheduler.pump();await flush()
  expect(calls).toEqual(['claude','codex','antigravity'])
  expect(h.notices).toContainEqual({reason:'provider_execution_failed',provider:'claude'})
  expect(successValue(h.ledger.read('claude')).state.nextDueMs).toBeGreaterThan(h.clock.now())
 })
 it('When canCollect is false Then performs no provider work',()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let calls=0
  const s=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>false,notice:h.notice,providers:[{id:'claude',intervalSec:900,run:async()=>{calls++}}]});s.pump();expect(calls).toBe(0)
 })
})
describe('Given a provider with adaptive intervals',()=>{
 it('When a rate limit is accepted Then schedules 900, reports entry once and resumes 300 after the hold',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let count=0
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:300,degrade:{intervalSec:900},run:async({markStarted})=>{
   if(!markStarted())return
   count++
   if(count<=2)h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,rateLimitedAtMs:[...(data.state.rateLimitedAtMs??[]),h.clock.now()]}}}))
  }}]})
  scheduler.pump();await flush()
  expect(successValue(h.ledger.read('claude')).state.nextDueMs).toBe(h.clock.now()+900000)
  expect(h.notices).toEqual([{reason:'claude_rate_limited_degraded',provider:'claude'}])
  h.advance(900000);scheduler.pump();await flush();expect(h.notices).toHaveLength(1)
  h.advance(2*86400000+1);scheduler.pump();await flush()
  expect(count).toBe(3)
  expect(successValue(h.ledger.read('claude')).state.nextDueMs).toBe(h.clock.now()+300000)
 })
 it('When a persisted 900 second due outlives the hold Then resumes at the current 300 second due',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation}),now=h.clock.now();let count=0
  h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,rateLimitedAtMs:[now-86400000],lastStartedAtMs:now-300001,nextDueMs:now+599999}}}))
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:300,degrade:{intervalSec:900},run:async({markStarted})=>{if(markStarted())count++}}]})
  scheduler.pump();expect(count).toBe(0);h.advance(1);scheduler.pump();await flush();expect(count).toBe(1)
 })
})
describe('Given a changing rate limit before an upstream call',()=>{
 it('When markStarted rereads the ledger Then it enforces the effective 900 second interval',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation}),now=h.clock.now();let started=true
  h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,lastStartedAtMs:now-300000,nextDueMs:now}}}))
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:300,degrade:{intervalSec:900},run:async({markStarted})=>{
   h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,rateLimitedAtMs:[now]}}}))
   started=markStarted()
  }}]})
  scheduler.pump();await flush();expect(started).toBe(false)
  expect(successValue(h.ledger.read('claude')).state.lastStartedAtMs).toBe(now-300000)
 })
})
describe('Given a Claude base interval above the degraded interval',()=>{
 it('When a rate limit is accepted Then preserves the longer interval and sends no degradation notice',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation})
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:1200,degrade:{intervalSec:900},run:async({markStarted})=>{
   markStarted();h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,rateLimitedAtMs:[h.clock.now()]}}}))
  }}]})
  scheduler.pump();await flush()
  expect(successValue(h.ledger.read('claude')).state.nextDueMs).toBe(h.clock.now()+1200000)
  expect(h.notices).toEqual([])
 })
})
describe('Given a gate-only tick near the end of degradation',()=>{
 it('When the hold expires Then the gate tick due also returns to the base interval',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation}),now=h.clock.now();let calls=0
  h.ledger.update('claude',data=>({ok:true,value:{...data,state:{...data.state,rateLimitedAtMs:[now-86400000+100000]}}}))
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'claude',intervalSec:300,degrade:{intervalSec:900},run:async()=>{calls++}}]})
  scheduler.pump();await flush();expect(calls).toBe(1)
  h.advance(300000);scheduler.pump();await flush();expect(calls).toBe(2)
 })
})
