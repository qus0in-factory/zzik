import {describe,it,expect} from 'vitest'
import {EventEmitter} from 'node:events'
import {runAgyQuotaCli} from '../../../../collector/infra/usage/agy-quota-cli-runner.mjs'

describe('Given an agy child that never closes',()=>{
 it('When quota uses default limits while model work hangs Then it returns without close after 15 seconds and two seconds grace',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true});let done=false
  const modelChild=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true})
  const model=runAgyQuotaCli({args:['models'],timeoutMs:5000,spawn:()=>modelChild})
  const start=Date.now();const result=await runAgyQuotaCli({spawn:()=>child}).then(value=>{done=true;return value})
  expect(await model).toBeNull();expect(result).toBeNull();expect(done).toBe(true);expect(Date.now()-start).toBeGreaterThanOrEqual(16900);expect(Date.now()-start).toBeLessThan(19000)
 },20000)
 it('When quota times out Then it returns after its termination grace without claiming close',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true});let closed=false
  const result=await runAgyQuotaCli({timeoutMs:5,graceMs:2,spawn:()=>child,onClose:()=>{closed=true}})
  expect(result).toBeNull();expect(closed).toBe(false)
 })
 it('When models time out Then late child output and close cannot change the returned result',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true})
  const result=await runAgyQuotaCli({args:['models'],timeoutMs:5,graceMs:2,spawn:()=>child})
  child.stdout.emit('data',Buffer.from('late'));child.emit('close',0);expect(result).toBeNull()
 })
})

import {createProviderScheduler} from '../../../../collector/app/usage/provider-scheduler.mjs'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
describe('Given scheduled quota and stalled model post-processing',()=>{
 it('When two quota children spawn Then their starts are at least 180 seconds apart',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});const spawns:number[]=[];let marks=0
  const scheduler=createProviderScheduler({mode:'d1',ledger:h.ledger,clock:h.clock,canCollect:()=>true,notice:h.notice,providers:[{id:'antigravity',intervalSec:180,run:async({markStarted})=>{if(!markStarted())return;marks++;await runAgyQuotaCli({spawn:()=>{spawns.push(h.clock.now());const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true});queueMicrotask(()=>child.emit('close',0));return child}})},afterRun:()=>new Promise<void>(()=>{})}]})
  scheduler.pump();for(let i=0;i<20;i++)await Promise.resolve();h.advance(179999);scheduler.pump();expect(spawns).toHaveLength(1);h.advance(1);scheduler.pump();for(let i=0;i<20;i++)await Promise.resolve();expect(marks).toBe(2);expect(spawns[1]-spawns[0]).toBeGreaterThanOrEqual(180000)
 })
})
