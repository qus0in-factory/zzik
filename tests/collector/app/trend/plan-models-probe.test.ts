import {describe,it,expect} from 'vitest'
import {createPlanModelsProbe} from '../../../../collector/app/trend/plan-models-probe.mjs'

describe('Given a resident model probe',()=>{
 it('When a provider fails Then it sends a daily notice and other providers still write',async()=>{
  let now=Date.parse('2026-11-17T15:00:00Z'), notices=0, writes=0
  const scheduled:Array<()=>void>=[], seen=new Set<string>()
  const probe=createPlanModelsProbe({clock:{now:()=>now},timer:{schedule:(_ms:number,fn:()=>void)=>{scheduled.push(fn);return ()=>{}}},state:{read:async()=>null,write:async()=>{}},runAgy:async()=>null,readClaude:()=>JSON.stringify({seven_day_fable:{scope:{model:{id:'claude-fable-1',display_name:'Fable'}}}}),query:{query:async()=>{writes++;return {ok:true,value:[]}}},claimNotice:(p:string)=>{if(seen.has(p))return false;seen.add(p);return true},notice:async()=>{notices++}})
  await probe.start();expect(writes).toBe(1);expect(notices).toBe(1)
  now+=6*3600000;scheduled.shift()?.();await probe.shutdown();expect(notices).toBe(1)
 })
 it('When shutting down Then the timer is cancelled and no new request starts',async()=>{
  let cancel=0, delay=-1;const probe=createPlanModelsProbe({clock:{now:()=>0},timer:{schedule:(ms:number)=>{delay=ms;return ()=>{cancel++}}},state:{read:async()=>({antigravity:0,claude:0}),write:async()=>{}},runAgy:async()=>null,readClaude:()=>null,query:{query:async()=>({ok:true,value:[]})},claimNotice:()=>true,notice:async()=>{}})
  await probe.start();expect(delay).toBe(6*3600000);await probe.shutdown();expect(cancel).toBe(1)
 })
})

describe('Given a failed probe state read',()=>{
 it('When state becomes readable Then a bounded timer retries and recovers',async()=>{
  let now=0,readCount=0,runCount=0,scheduled:()=>void=()=>{},delay=0
  const probe=createPlanModelsProbe({providers:['antigravity'],clock:{now:()=>now},timer:{schedule:(ms:number,fn:()=>void)=>{delay=ms;scheduled=fn;return ()=>{}}},state:{read:async()=>{if(++readCount===1)throw Error();return null},write:async()=>{}},retryState:{read:async()=>null,write:async()=>{}},runAgy:async()=>{runCount++;return 'model\tModel'},readClaude:()=>null,query:{query:async()=>({ok:true,value:[]})},claimNotice:()=>true,notice:async()=>{}})
  await probe.start();expect(delay).toBe(6*3600000);now+=delay;scheduled();await new Promise(resolve=>setTimeout(resolve,0));expect(runCount).toBe(1);await probe.shutdown()
 })
 it('When shutdown begins during a running probe Then it waits for the request',async()=>{
  let release:(v:string|null)=>void=()=>{},finished=false
  const probe=createPlanModelsProbe({providers:['antigravity'],clock:{now:()=>0},timer:{schedule:()=>()=>{}},state:{read:async()=>null,write:async()=>{}},retryState:{read:async()=>null,write:async()=>{}},runAgy:()=>new Promise(resolve=>{release=resolve}),readClaude:()=>null,query:{query:async()=>({ok:true,value:[]})},claimNotice:()=>true,notice:async()=>{}})
  const start=probe.start();await new Promise(resolve=>setTimeout(resolve,0));const end=probe.shutdown().then(()=>{finished=true});await Promise.resolve();expect(finished).toBe(false);release(null);await Promise.all([start,end]);expect(finished).toBe(true)
 })
})

describe('Given a failed provider attempt',()=>{
 it('When the collector restarts Then the persisted retry time prevents another attempt for six hours',async()=>{
  let now=100000,attempts=0;let saved:Record<string,number>={};let delay=0
  const options={providers:['antigravity'],clock:{now:()=>now},timer:{schedule:(ms:number)=>{delay=ms;return ()=>{}}},state:{read:async()=>null,write:async()=>{}},retryState:{read:async()=>saved,write:async(value:Record<string,number>)=>{saved=value}},runAgy:async()=>{attempts++;return null},readClaude:()=>null,query:{query:async()=>({ok:true,value:[]})},claimNotice:()=>true,notice:async()=>{}}
  const first=createPlanModelsProbe(options);await first.start();await first.shutdown();expect(saved).toEqual({antigravity:now})
  now+=1000;const second=createPlanModelsProbe(options);await second.start();expect(attempts).toBe(1);expect(delay).toBe(6*3600000-1000);await second.shutdown()
 })
})
