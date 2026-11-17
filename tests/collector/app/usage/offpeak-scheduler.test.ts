import {describe,it,expect} from 'vitest'
import {createOffpeakScheduler} from '../../../../collector/app/usage/offpeak-scheduler.mjs'
const at=Date.parse,base=at('2026-11-17T00:00:00Z')
const schedule={opencode:{windows:[{start:'00:00',end:'02:00'}]},ollama:{windows:[{start:'00:00',end:'02:00'}]}}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
function fixture(start=base,saved:unknown=null){
 let now=start;const tasks=new Map<number,{at:number,run:()=>void}>(),sent:any[][]=[],logs:string[]=[],trace:string[]=[];let sequence=0,writes=0
 const state={read:async()=>saved,write:async(value:any)=>{trace.push('persist');writes++;saved=structuredClone(value)}}
 const timer={schedule(ms:number,run:()=>void){const id=++sequence;tasks.set(id,{at:now+ms,run});return()=>{tasks.delete(id)}}}
 const send=async(events:any[])=>{trace.push('send');sent.push(events)}
 const options={schedule,clock:{now:()=>now},timer,state,send,log:(reason:string)=>logs.push(reason)}
 return{options,state,tasks,sent,logs,trace,save:()=>saved,writes:()=>writes,setNow:(v:number)=>{now=v},fire:async(late=0)=>{const [id,task]=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0]!;tasks.delete(id);now=task.at+late;task.run();await flush()},now:()=>now}
}
describe('Given an injected one-shot off-peak scheduler',()=>{
 it('When started twice Then keeps exactly one next-event timer without polling and merges sends',async()=>{
  const f=fixture(),s=createOffpeakScheduler(f.options);await s.start();await s.start()
  expect(f.tasks.size).toBe(1);expect([...f.tasks.values()][0]!.at).toBe(base+10*60000)
  await f.fire();expect(f.sent).toHaveLength(1);expect(f.sent[0]).toHaveLength(2);expect(f.trace).toEqual(['persist','send']);expect(f.tasks.size).toBe(1)
  expect([...f.tasks.values()][0]!.at).toBe(base+110*60000);await s.shutdown();expect(f.tasks.size).toBe(0)
 })
 it('When restarting within two minutes Then catches up; more than two minutes late is skipped',async()=>{
  for(const [late,expected] of [[120000,1],[120001,0]] as const){const f=fixture(base+10*60000+late),s=createOffpeakScheduler(f.options);await s.start();if(expected)await f.fire();expect(f.sent).toHaveLength(expected);expect([...f.tasks.values()][0]!.at).toBe(base+110*60000);await s.shutdown()}
 })
 it('When the machine wakes over two minutes late Then skips that callback and arms the next event',async()=>{
  const f=fixture(),s=createOffpeakScheduler(f.options);await s.start();await f.fire(120001);expect(f.sent).toHaveLength(0);expect(f.writes()).toBe(0);expect([...f.tasks.values()][0]!.at).toBe(base+110*60000);await s.shutdown()
 })
 it('When restarting after a claimed send Then never sends the same keys twice',async()=>{
  const f=fixture(),s=createOffpeakScheduler(f.options);await s.start();await f.fire();await s.shutdown()
  const next=fixture(f.now(),f.save()),again=createOffpeakScheduler(next.options);await again.start();expect([...next.tasks.values()][0]!.at).toBe(base+110*60000);expect(next.sent).toHaveLength(0);await again.shutdown()
 })
 it('When state cannot be read or claimed Then disables this scheduler without sending or exposing the error',async()=>{
  for(const mode of ['read','corrupt','write']){const f=fixture(),options={...f.options,state:mode==='read'?{...f.state,read:async()=>{throw Error('private webhook')}}:mode==='corrupt'?{...f.state,read:async()=>({v:0,keys:{}})}:{...f.state,write:async()=>{throw Error('private webhook')}}},s=createOffpeakScheduler(options);await s.start();if(mode==='write')await f.fire();expect(f.sent).toHaveLength(0);expect(f.tasks.size).toBe(0);expect(f.logs).toEqual(['state_failed']);await s.shutdown()}
 })
 it('When sending fails Then keeps the persisted claim and never retries the ambiguous delivery',async()=>{
  const f=fixture(),s=createOffpeakScheduler({...f.options,send:async()=>{throw Error('private webhook')}});await s.start();await f.fire();expect(f.writes()).toBe(1);expect(f.logs).toEqual(['send_failed']);expect([...f.tasks.values()][0]!.at).toBe(base+110*60000);await s.shutdown()
 })
 it('When shutdown interrupts a state claim Then waits for it and never begins a late send',async()=>{
  const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r});const s=createOffpeakScheduler({...f.options,state:{...f.state,write:async()=>gate}});await s.start();await f.fire();const done=s.shutdown();expect(f.tasks.size).toBe(0);release();await done;expect(f.sent).toHaveLength(0)
 })
 it('When shutdown occurs during delivery Then waits for the in-flight send without arming another timer',async()=>{
  const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r});const s=createOffpeakScheduler({...f.options,send:async()=>gate});await s.start();await f.fire();let closed=false;const done=s.shutdown().then(()=>{closed=true});await flush();expect(closed).toBe(false);release();await done;expect(f.tasks.size).toBe(0)
 })
 it('When the clock moves backwards before a callback Then never sends an event early',async()=>{
  const f=fixture(),s=createOffpeakScheduler(f.options);await s.start();await f.fire(-60000);expect(f.sent).toHaveLength(0);expect([...f.tasks.values()][0]!.at).toBe(base+10*60000);await s.shutdown()
 })
})
