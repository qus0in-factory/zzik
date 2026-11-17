import {describe,it,expect} from 'vitest'
import {EventEmitter} from 'node:events'
import {runAgyQuotaCli} from '../../../../collector/infra/usage/agy-quota-cli-runner.mjs'

describe('Given a model CLI process',()=>{
 it('When its signal is aborted Then the runner resolves without waiting for close',async()=>{
  const signal=new AbortController(),child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true})
  const result=runAgyQuotaCli({args:['models'],signal:signal.signal,spawn:()=>child})
  signal.abort();expect(await result).toBeNull()
 })
})
