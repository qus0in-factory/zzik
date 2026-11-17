import {describe,it,expect} from 'vitest'
import {EventEmitter} from 'node:events'
import {runAgyQuotaCli} from '../../../../collector/infra/usage/agy-quota-cli-runner.mjs'
import {createAgyLane} from '../../../../collector/app/trend/agy-lane.mjs'

describe('Given a model CLI process',()=>{
 it('When quota cancels the model Then the next spawn waits for child close',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true});const calls:string[]=[]
  const lane=createAgyLane(async(kind,signal)=>{calls.push(kind);return kind==='models'?runAgyQuotaCli({args:['models'],signal,spawn:()=>child}):'quota'})
  const model=lane.models();await Promise.resolve();const quota=lane.quota();await new Promise(resolve=>setImmediate(resolve));expect(calls).toEqual(['models'])
  child.emit('close',null);await Promise.all([model,quota]);expect(calls).toEqual(['models','quota'])
 })
})

describe('Given a quota process with excessive output',()=>{
 it('When a model is queued Then it waits until quota child closes',async()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),kill:()=>true});const calls:string[]=[]
  const lane=createAgyLane(async(kind,signal)=>{calls.push(kind);return kind==='quota'?runAgyQuotaCli({signal,maxOutputBytes:1,waitForCloseOnKill:true,spawn:()=>child}):'models'})
  const quota=lane.quota();await Promise.resolve();const model=lane.models();child.stdout.emit('data',Buffer.from('excess'));await new Promise(resolve=>setImmediate(resolve));expect(calls).toEqual(['quota'])
  child.emit('close',null);await Promise.all([quota,model]);expect(calls).toEqual(['quota','models'])
 })
})
