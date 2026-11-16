import {describe,it,expect,vi} from 'vitest'
import {createResidentCollector} from '../../../../collector/app/usage/resident-collector.mjs'
import {runCycle} from '../../../../collector/app/usage/run-cycle.mjs'
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
describe('Given the real serial PG cycle under the resident runner',()=>{
 it('When a tick arrives while the PG cycle is active Then logs the legacy skip message',async()=>{
  const write=vi.spyOn(process.stderr,'write').mockImplementation(()=>true)
  let release!:()=>void;const gate=new Promise<void>(r=>{release=r})
  const runner=createResidentCollector({periodMs:900000,timer:{schedule:()=>()=>{}},run:async()=>{await gate},close:async()=>{},onError:()=>{}})
  try{runner.start();runner.tick();expect(write).toHaveBeenCalledWith(expect.stringContaining('이전 주기가 아직 진행 중'))}finally{release();await gate;await new Promise(r=>setTimeout(r,0));write.mockRestore()}
 })
 it('When shutdown occurs during BEGIN Then waits for COMMIT and never begins another provider or prune',async()=>{
  const events:string[]=[];let release!:()=>void;let deadline!:()=>void
  const runner=createResidentCollector({periodMs:900000,timer:{schedule:(ms:number,fn:()=>void)=>{if(ms===30000)deadline=fn;return ()=>{}}},close:async()=>{events.push('close')},onError:()=>{},run:async shouldStop=>runCycle({runOnce:async()=>{events.push('BEGIN');await new Promise<void>(r=>{release=r});events.push('COMMIT');return {exitCode:0}}},[{id:'claude',ports:{} as never},{id:'codex',ports:{} as never}],{shouldStop})})
  runner.start();await flush();runner.tick();expect(events).toEqual(['BEGIN']);const done=runner.shutdown();expect(events).toEqual(['BEGIN']);release();expect(await done).toEqual({timedOut:false});expect(events).toEqual(['BEGIN','COMMIT','close']);expect(deadline).toBeTypeOf('function')
 })
})

import {createTestDb} from '../../../fakes/pglite-db'
import {createFakeCollectorPorts} from '../../../fakes/collector-ports'
import {createPostgresEnvelopeWriter} from '../../../../collector/infra/usage/postgres-envelope-writer.mjs'
describe('Given a single real synthetic PG connection with rollback-sensitive writes',()=>{
 it('When resident ticks overlap Then a failed first transaction rolls back before the next BEGIN',async()=>{
  const db=await createTestDb();let release!:()=>void,entered!:()=>void,finished!:()=>void
  const enteredPromise=new Promise<void>(r=>{entered=r}),finishedPromise=new Promise<void>(r=>{finished=r})
  const trace:string[]=[];let active=0,maxActive=0,current=''
  const writer=createPostgresEnvelopeWriter({execute:async(text:string,params?:unknown[])=>{
   if(text==='BEGIN'){active++;maxActive=Math.max(maxActive,active);trace.push(text);const result=await db.client.query(text,params);if(trace.length===1){entered();await new Promise<void>(r=>{release=r})}return result}
   if(text.includes('INSERT INTO usage_snapshot'))current=String(params?.[0])
   if(text.includes('INSERT INTO usage_event')&&current==='claude')throw Object.assign(Error('synthetic constraint'),{code:'23514'})
   const result=await db.client.query(text,params)
   if(text==='ROLLBACK'||text==='COMMIT'){trace.push(text);active--}
   return result
  }})
  const providers=['claude','codex'].map(id=>{const p=createFakeCollectorPorts();return {id,ports:{...p,store:writer}}})
  const runner=createResidentCollector({periodMs:900000,timer:{schedule:()=>()=>{}},close:async()=>{},onError:()=>{},run:async shouldStop=>{await runCycle({},providers,{shouldStop});finished()}})
  try{
   runner.start();await enteredPromise;runner.tick();runner.tick();expect(maxActive).toBe(1);expect(trace).toEqual(['BEGIN']);release();await finishedPromise;await runner.shutdown()
   expect(trace).toEqual(['BEGIN','ROLLBACK','BEGIN','COMMIT']);expect(maxActive).toBe(1)
   expect((await db.client.query<{provider:string}>('SELECT provider FROM usage_snapshot')).rows.map(r=>r.provider)).toEqual(['codex'])
  }finally{await db.close()}
 })
})
