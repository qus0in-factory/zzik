import { describe, it, expect } from 'vitest'
import { createFanoutWriter } from '../../../../collector/infra/usage/fanout-writer.mjs'
const meta={provider:'claude',status:'ok',runAt:'2026-11-13T00:00:00Z',fetchedAt:null,rawSha256:null,collectorVersion:'0.5.0',changed:true}
describe('Given dual snapshot destinations', () => {
  it('When one fails or throws Then still attempts all writers sequentially and aggregates safe failures', async () => {
    const calls:string[]=[]
    const writer=createFanoutWriter([
      {write:async()=>{calls.push('first');return {ok:false as const,message:'first failed',httpStatus:null}}},
      {write:async(value:string,seen:typeof meta)=>{calls.push('second');expect(seen).toEqual(meta);expect(value).toBe('{}');return {ok:true as const}}},
    ])
    expect(await writer.write('{}',meta)).toMatchObject({ok:false,message:'first failed'})
    expect(calls).toEqual(['first','second'])
    expect(await createFanoutWriter([{write:async()=>{throw Error('postgres://secret')}}]).write('{}',meta)).toMatchObject({ok:false,message:'Error'})
  })
})
