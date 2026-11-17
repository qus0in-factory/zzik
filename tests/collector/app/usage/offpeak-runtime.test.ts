import { describe, expect, it } from 'vitest'
import { createOffpeakRuntime } from '../../../../collector/app/usage/offpeak-runtime.mjs'

describe('Given the resident notification runtime', () => {
  it('When disabled or in a nonresident mode Then no notifier is constructed', () => {
    for (const options of [{once:true}, {dryRun:true}, {resume:true}, {enabled:false}, {webhook:false}]) {
      let made = false
      const runtime = createOffpeakRuntime({once:false,dryRun:false,resume:false,enabled:true,webhook:true,...options,create:()=>{made=true;return {start:async()=>{},shutdown:async()=>{}}}})
      expect(runtime).toBeNull()
      expect(made).toBe(false)
    }
  })
  it('When shutdown begins Then notifier and collector stop synchronously and wait together', async () => {
    const order: string[] = []
    let finish!: () => void
    const notifier = {start:async()=>{},shutdown:()=>{order.push('notifier');return new Promise<void>(resolve=>{finish=resolve})}}
    const runtime = createOffpeakRuntime({once:false,dryRun:false,resume:false,enabled:true,webhook:true,create:()=>notifier})!
    let cancel = false
    const shutting = runtime.shutdownWith({shutdown:async()=>{order.push('collector');return {timedOut:false}}}, {schedule:()=>()=>{cancel=true}})
    expect(order).toEqual(['notifier','collector'])
    finish()
    expect(await shutting).toEqual({timedOut:false})
    expect(cancel).toBe(true)
  })
})
