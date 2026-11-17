import {describe,it,expect} from 'vitest'
import {createAgyLane} from '../../../../collector/app/trend/agy-lane.mjs'

describe('Given agy requests share a lane',()=>{
 it('When quota and models are queued Then quota has priority and no process overlaps',async()=>{
  let release:()=>void=()=>{};let active=0,max=0;const order:string[]=[]
  const lane=createAgyLane(async (kind:string)=>{active++;max=Math.max(max,active);order.push(kind);if(order.length===1)await new Promise<void>(resolve=>{release=resolve});active--;return kind})
  const first=lane.models();await Promise.resolve();const second=lane.models(),quota=lane.quota();release();await Promise.all([first,second,quota]);expect(max).toBe(1);expect(order).toEqual(['models','quota','models'])
 })
})

describe('Given a queued model call',()=>{
 it('When shutdown cancels queued models Then no model process starts',async()=>{
  let release:()=>void=()=>{};const calls:string[]=[]
  const lane=createAgyLane(async(kind:string)=>{calls.push(kind);await new Promise<void>(resolve=>{release=resolve});return kind})
  const quota=lane.quota();await Promise.resolve();const model=lane.models();lane.cancelModels();expect(await model).toBeNull();expect(calls).toEqual(['quota']);release();await quota
 })
})
