import {describe,it,expect} from 'vitest'
import {createStartupGate} from '../../../../collector/app/usage/startup-quiesce.mjs'
describe('Given a startup reconciliation phase and an active runtime phase',()=>{
 it('When shutdown arrives during reconciliation Then it stops new work and waits for reconciliation before closing startup',async()=>{
  let release!:()=>void
  let stopFn:()=>boolean=()=>false
  let closed=0,ready=0
  const gate=createStartupGate({
   timer:{schedule:()=>()=>{}},
   reconcile:async stop=>{stopFn=stop;await new Promise<void>(r=>{release=r});return {ok:true}},
   closeStartup:async()=>{closed+=1},
   onReady:()=>{ready+=1;return {shutdown:async()=>({timedOut:false})}},
  })
  const started=gate.start()
  const shutdown=gate.shutdown()
  expect(gate.stopping()).toBe(true)
  expect(stopFn()).toBe(true)
  expect(closed).toBe(0)
  release()
  expect(await started).toEqual({ok:true})
  expect(await shutdown).toEqual({timedOut:false})
  expect(closed).toBe(1)
  expect(ready).toBe(0)
 })
 it('When the runtime is active Then shutdown routes to the runtime without closing startup twice',async()=>{
  let runtimeShutdown=0,closed=0
  const gate=createStartupGate({
   timer:{schedule:()=>()=>{}},
   reconcile:async()=>({ok:true}),
   closeStartup:async()=>{closed+=1},
   onReady:()=>({shutdown:async()=>{runtimeShutdown+=1;return {timedOut:false}}}),
  })
  await gate.start()
  gate.activate()
  expect(await gate.shutdown()).toEqual({timedOut:false})
  expect(runtimeShutdown).toBe(1)
  expect(closed).toBe(0)
 })
})
