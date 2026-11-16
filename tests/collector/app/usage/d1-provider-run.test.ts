import {describe,it,expect} from 'vitest'
import {runD1Provider} from '../../../../collector/app/usage/run-d1-provider.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {D1_OPERATION_ID,successValue} from '../../../fakes/d1-contract'
describe('Given a staged provider observation and the D1 ledger',()=>{
 it('When collecting Then atomically queues and never reports a remote ack or writes legacy JSON',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});let legacyWrites=0,upstream=0;const logs:unknown[]=[]
  const result=await runD1Provider({provider:'claude',ledger:h.ledger,clock:h.clock,intervalSec:900,operationId:()=>D1_OPERATION_ID,context:{markStarted:()=>true,isStopping:()=>false},ports:{clock:h.clock,credentials:{readAll:async()=>[{source:'fake',token:'fake',expiresAt:null}]},usage:{fetchUsage:async()=>{upstream++;return {ok:true,bodyText:'{"five_hour":{"utilization":37}}',httpStatus:200,retryAfterSec:null}}},store:{write:async()=>{throw Error('PG must not write')}},state:{read:async()=>null,write:async()=>{legacyWrites++}},logger:{write:async e=>{logs.push(e)}}}})
  expect(result.reason).toBe('queued');expect(upstream).toBe(1);expect(legacyWrites).toBe(0);expect(h.data.get('claude')!.rows).toHaveLength(1);expect(logs[0]).toMatchObject({kvOk:false})
 })
 it('When the observation clock retreats Then discards it without seq, event or baseline changes',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});h.queue();h.advance(-1000);const before=successValue(h.ledger.read('claude'))
  const result=await runD1Provider({provider:'claude',ledger:h.ledger,clock:h.clock,intervalSec:900,operationId:()=>D1_OPERATION_ID,context:{markStarted:()=>true,isStopping:()=>false},ports:{clock:h.clock,credentials:{readAll:async()=>[]},usage:{fetchUsage:async()=>{throw Error('none')}},store:{write:async()=>{throw Error('none')}},state:{read:async()=>null,write:async()=>{}},logger:{write:async()=>{}}}})
  expect(result.reason).toBe('clock_skew');expect(successValue(h.ledger.read('claude'))).toEqual(before)
 })
})
