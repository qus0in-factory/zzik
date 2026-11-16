import {describe,it,expect} from 'vitest'
import {createQuiescer} from '../../../../collector/app/usage/quiesce.mjs'
describe('Given current provider/PG/sender work at shutdown',()=>{
 it('When SIGTERM is requested twice Then stops starts immediately but waits for the same in-flight work before close',async()=>{
  let release!:()=>void,stop=0,closed=0;const work=new Promise<void>(r=>{release=r});const timers:Array<{ms:number;fn:()=>void}>=[]
  const q=createQuiescer({stop:()=>{stop++},pending:()=>[work],close:async()=>{closed++},timer:{schedule:(ms:number,fn:()=>void)=>{timers.push({ms,fn});return ()=>{}}}})
  const first=q.shutdown(),second=q.shutdown();expect(stop).toBe(1);expect(closed).toBe(0);expect(timers[0].ms).toBe(30000);expect(first).toBe(second);release();expect(await first).toEqual({timedOut:false});expect(closed).toBe(1)
 })
 it('When work does not finish by 30 seconds Then returns timeout without waiting forever',async()=>{
  let deadline!:()=>void;const q=createQuiescer({stop:()=>{},pending:()=>[new Promise(()=>{})],close:async()=>{},timer:{schedule:(_ms:number,fn:()=>void)=>{deadline=fn;return ()=>{}}}})
  const result=q.shutdown();deadline();expect(await result).toEqual({timedOut:true})
 })
})
