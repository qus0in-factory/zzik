import {describe,it,expect,vi} from 'vitest'
import {createResidentCollector} from '../../../../collector/app/usage/resident-collector.mjs'
import {runCycle} from '../../../../collector/app/usage/run-cycle.mjs'
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
describe('Given the real serial dry-run cycle under the resident runner',()=>{
 it('When a tick arrives while the dry-run cycle is active Then logs the legacy skip message',async()=>{
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
