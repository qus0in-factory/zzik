import {describe,it,expect} from 'vitest'
import {resumeQuarantinedProvider} from '../../../../collector/app/usage/resume-quarantine.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
describe('Given an explicit quiesced D1 operator resume request',()=>{
 it('When receipt absence is confirmed Then passes only authoritative null facts; unknown/read failure refuses',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});h.queue();h.queue('claude',2);h.data.get('claude')!.rows[0].quarantined=true
  let calls=0;const resume=(_p:unknown,facts:unknown)=>{calls++;expect(Object.values(facts as object)).toEqual([null,null]);return {ok:true}}
  h.responses.push({ok:false,reason:'retry',status:503,retryAfterMs:0})
  const options={mode:'d1',provider:'claude' as const,ledger:h.ledger,query:h.query,resume}
  expect((await resumeQuarantinedProvider(options)).ok).toBe(false);expect(calls).toBe(0)
  h.responses.push({ok:true,value:[{results:[]}]});expect((await resumeQuarantinedProvider(options)).ok).toBe(true);expect(calls).toBe(1)
 })
 it('When a receipt exists or PG mode is requested Then never discards local operations',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});h.queue();h.data.get('claude')!.rows[0].quarantined=true
  const resume=()=>{throw Error('must not discard')},options={provider:'claude' as const,ledger:h.ledger,query:h.query,resume}
  expect((await resumeQuarantinedProvider({...options,mode:'postgres'})).ok).toBe(false);expect(h.calls).toHaveLength(0)
  h.responses.push({ok:true,value:[{results:[{operation_id:'present'}]}]});expect((await resumeQuarantinedProvider({...options,mode:'d1'})).ok).toBe(false)
 })
})
