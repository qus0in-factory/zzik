import {describe,it,expect} from 'vitest'
import {reconcileD1Startup} from '../../../../collector/app/usage/d1-startup.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
describe('Given local pending operations and remote sequence facts',()=>{
 it('When another operation already owns the seq Then stops without renumbering local bytes',async()=>{
  const h=senderFixture({initialLedgerState,acceptObservation});h.queue();const before=structuredClone(h.data.get('claude'))
  h.responses.push({ok:true,value:[{results:[{write_seq:1}]}]},{ok:true,value:[{results:[{operation_id:'22222222-2222-4222-8222-222222222222',provider:'claude',write_seq:1,payload_sha256:'a'.repeat(64),created_at_ms:h.clock.now()}]}]})
  expect((await reconcileD1Startup({ledger:h.ledger,query:h.query,providers:['claude'],clock:h.clock,notifyAlerts:h.notifyAlerts})).ok).toBe(false);expect(h.data.get('claude')).toEqual(before)
 })
})
