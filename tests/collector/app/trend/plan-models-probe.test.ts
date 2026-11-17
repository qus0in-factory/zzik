import {describe,it,expect} from 'vitest'
import {createPlanModelsProbe} from '../../../../collector/app/trend/plan-models-probe.mjs'

describe('Given a resident model probe',()=>{
 it('When a provider fails Then it sends a daily notice and other providers still write',async()=>{
  let now=Date.parse('2026-11-17T15:00:00Z'), notices=0, writes=0
  const scheduled:Array<()=>void>=[], seen=new Set<string>()
  const probe=createPlanModelsProbe({clock:{now:()=>now},timer:{schedule:(_ms:number,fn:()=>void)=>{scheduled.push(fn);return ()=>{}}},state:{read:async()=>null,write:async()=>{}},runAgy:async()=>null,readClaude:()=>JSON.stringify({seven_day_fable:{scope:{model:{display_name:'Fable'}}}}),query:{query:async()=>{writes++;return {ok:true,value:[]}}},claimNotice:(p:string)=>{if(seen.has(p))return false;seen.add(p);return true},notice:async()=>{notices++}})
  await probe.start();expect(writes).toBe(1);expect(notices).toBe(1)
  now+=6*3600000;scheduled.shift()?.();await probe.shutdown();expect(notices).toBe(1)
 })
 it('When shutting down Then the timer is cancelled and no new request starts',async()=>{
  let cancel=0, delay=-1;const probe=createPlanModelsProbe({clock:{now:()=>0},timer:{schedule:(ms:number)=>{delay=ms;return ()=>{cancel++}}},state:{read:async()=>({antigravity:0,claude:0}),write:async()=>{}},runAgy:async()=>null,readClaude:()=>null,query:{query:async()=>({ok:true,value:[]})},claimNotice:()=>true,notice:async()=>{}})
  await probe.start();expect(delay).toBe(6*3600000);await probe.shutdown();expect(cancel).toBe(1)
 })
})
