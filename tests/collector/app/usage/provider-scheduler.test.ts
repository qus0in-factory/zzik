import {describe,it,expect} from 'vitest'
import {createProviderScheduler} from '../../../../collector/app/usage/provider-scheduler.mjs'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {successValue} from '../../../fakes/d1-contract'
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
function setup(mode:'postgres'|'d1'='d1'){
 const h=senderFixture({initialLedgerState,acceptObservation});const calls:string[]=[];const release:Array<()=>void>=[]
 const scheduler=createProviderScheduler({mode,ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:['claude','codex','antigravity'].map(id=>({id:id as 'claude'|'codex'|'antigravity',intervalSec:900,run:async({markStarted}:{markStarted:()=>boolean})=>{if(!markStarted())return;calls.push(id);await new Promise<void>(r=>release.push(r))}}))})
 return {...h,scheduler,calls,release}
}
describe('Given provider due times and upstream-start checkpoints',()=>{
 it('When D1 ticks overlap Then runs at most two providers and one instance of each',async()=>{
  const h=setup();h.scheduler.pump();h.scheduler.pump();expect(h.calls).toEqual(['claude','codex']);h.release.shift()!();await flush();h.scheduler.pump();expect(h.calls).toEqual(['claude','codex','antigravity']);h.release.splice(0).forEach(r=>r());await flush()
 })
 it('When PG ticks overlap Then never overlaps provider transactions',async()=>{
  const h=setup('postgres');h.scheduler.pump();h.scheduler.pump();expect(h.calls).toEqual(['claude']);h.release.shift()!();await flush();h.scheduler.pump();expect(h.calls).toEqual(['claude','codex']);h.release.splice(0).forEach(r=>r());await flush()
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
 it('When canCollect is false Then performs no provider work',()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let calls=0
  const s=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>false,notice:h.notice,providers:[{id:'claude',intervalSec:900,run:async()=>{calls++}}]});s.pump();expect(calls).toBe(0)
 })
})
