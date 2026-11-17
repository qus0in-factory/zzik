import { describe, expect, it } from 'vitest'
import { acceptObservation, acknowledgeOperation, breakChain, initialLedgerState, reconcileSequence, queueHealth } from '../../../../collector/domain/usage/d1-ledger.mjs'
import { D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'
const now = Date.parse(D1_NOW)
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`
const sample = (value: number, at = now) => d1Envelope({runAt:new Date(at).toISOString(), rawText:JSON.stringify({five_hour:{utilization:value}})})
const accept = (data: ReturnType<typeof initialLedgerState>, value: number, n: number, at = now+n) => successValue(acceptObservation(data,{envelope:sample(value,at),operationId:id(n),nowMs:at,lastStartedAtMs:at,nextDueMs:at+900000,alerts:[]}))
describe('Given a durable accepted chain and a separate remote committed baseline', () => {
  it('When accepting and acknowledging Then atomically fixes bytes, seq and event baseline without treating queueing as remote success', () => {
    const first=accept(initialLedgerState(),1,1)
    expect(first.rows[0].operation.writeSeq).toBe(1)
    expect(first.state.remoteCommitted).toBeNull()
    const ack=successValue(acknowledgeOperation(first,{...first.rows[0].operation,createdAtMs:now}))
    expect(ack.rows).toHaveLength(0)
    expect(ack.state.remoteCommitted).toEqual(first.state.previous)
    expect(ack.state.ackedSeq).toBe(1)
    expect(acknowledgeOperation(first,{...first.rows[0].operation,payloadSha256:'bad',createdAtMs:now}).ok).toBe(false)
  })
  for(const mode of ['discard_400','resume_without_quarantine'] as const) {
    it(`When ${mode} breaks N Then the next accepted N+1 compares with committed N-1`, () => {
      const first=accept(initialLedgerState(),1,1)
      const committed=successValue(acknowledgeOperation(first,{...first.rows[0].operation,createdAtMs:now}))
      const n=accept(committed,2,2)
      if(mode==='resume_without_quarantine') n.rows[0].quarantined=true
      const reset=successValue(breakChain(n,{operationId:id(2),mode,receipts:{[id(2)]:null}}))
      expect(reset.state.previous).toEqual(committed.state.remoteCommitted)
      expect(reset.state.lastEventAt).toBe(committed.state.remoteCommittedLastEventAt)
      expect(accept(reset,2,3).rows[0].operation.emitEvent).toBe(true)
    })
    it(`When ${mode} drops N with an already queued successor Then refixes only receipt-absent successor with N-1 and never renumbers`, () => {
      const first=accept(initialLedgerState(),1,1)
      const committed=successValue(acknowledgeOperation(first,{...first.rows[0].operation,createdAtMs:now}))
      const queued=accept(accept(committed,2,2),2,3)
      if(mode==='resume_without_quarantine') queued.rows[0].quarantined=true
      expect(queued.rows[1].operation.emitEvent).toBe(false)
      const before=queued.rows[1].operation
      const reset=successValue(breakChain(queued,{operationId:id(2),mode,receipts:{[id(2)]:null,[id(3)]:null}}))
      const after=reset.rows[0].operation
      expect(after).toMatchObject({operationId:before.operationId,writeSeq:before.writeSeq,emitEvent:true})
      expect(after.payloadSha256).not.toBe(before.payloadSha256)
      expect(breakChain(queued,{operationId:id(2),mode,receipts:{[id(2)]:null}})).toEqual({ok:false,reason:'receipt_required'})
      expect(breakChain(queued,{operationId:id(2),mode,receipts:{[id(2)]:null,[id(3)]:{...before,createdAtMs:now}}})).toEqual({ok:false,reason:'successor_already_committed'})
      expect(queued.rows[1].operation).toEqual(before)
    })
  }
  it('When the next sequence is already queued Then refuses a replacement id without renumbering', () => {
    const data=accept(initialLedgerState(),1,1)
    data.state.nextSeq=1
    expect(acceptObservation(data,{envelope:sample(2),operationId:id(2),nowMs:now,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]}))
      .toEqual({ok:false,reason:'sequence_conflict'})
  })
  it('When a token expiry is accepted Then lastRun retains the legacy numeric expiry input', () => {
    const data=successValue(acceptObservation(initialLedgerState(),{envelope:sample(1),operationId:id(1),nowMs:now,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]}))
    expect(data.state.lastRun).toEqual({status:'ok',tokenExpiresAt:null})
  })
  it('When queue count, bytes or age reach limits Then blocks collection and quarantines only strictly older than seven days', () => {
    expect(queueHealth({count:25000,bytes:0,oldestMs:null},now).collect).toBe(false)
    expect(queueHealth({count:1,bytes:256*1024*1024,oldestMs:now},now).collect).toBe(false)
    expect(queueHealth({count:1,bytes:1,oldestMs:now-7*86400000},now)).toMatchObject({collect:false,quarantine:false})
    expect(queueHealth({count:1,bytes:1,oldestMs:now-7*86400000-1},now).quarantine).toBe(true)
  })
  it('When seq facts conflict Then stops without renumbering; safe upper bound stops', () => {
    const data=accept(initialLedgerState(),1,1)
    expect(successValue(reconcileSequence(data,10,{})).state.nextSeq).toBe(11)
    expect(reconcileSequence(data,10,{[id(1)]:{...data.rows[0].operation,writeSeq:2,createdAtMs:now}})).toEqual({ok:false,reason:'receipt_conflict'})
    expect(reconcileSequence(data,Number.MAX_SAFE_INTEGER,{}).ok).toBe(false)
  })
})
describe('Given rate limit history in provider state',()=>{
 it('When accepting a rate limit after its run starts Then records the acceptance time',()=>{
  const envelope=d1Envelope({runAt:new Date(now).toISOString(),status:'rate_limited',called:true,httpStatus:429,rawText:null})
  const result=successValue(acceptObservation(initialLedgerState(),{envelope,operationId:id(1),nowMs:now+100,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]}))
  expect(result.state.rateLimitedAtMs).toEqual([now+100])
 })
 it('When a called rate limit is accepted Then keeps the latest ten in seven days and old states remain readable',()=>{
  let data=initialLedgerState()
  for(let n=1;n<=12;n++){
   const at=now+n
   const envelope=d1Envelope({runAt:new Date(at).toISOString(),status:'rate_limited',called:true,httpStatus:429,rawText:null})
   data=successValue(acceptObservation(data,{envelope,operationId:id(n),nowMs:at,lastStartedAtMs:at,nextDueMs:at+900000,alerts:[]}))
  }
  expect(data.state.rateLimitedAtMs).toEqual(Array.from({length:10},(_,i)=>now+i+3))
  const future=now+8*86400000
  const envelope=d1Envelope({runAt:new Date(future).toISOString(),status:'rate_limited',called:true,httpStatus:429,rawText:null})
  data=successValue(acceptObservation(data,{envelope,operationId:id(13),nowMs:future,lastStartedAtMs:future,nextDueMs:future+900000,alerts:[]}))
  expect(data.state.rateLimitedAtMs).toEqual([future])
  expect(accept(data,1,14,future+1).state.rateLimitedAtMs).toEqual([future])
  const gated=d1Envelope({runAt:new Date(future+2).toISOString(),status:'rate_limited',called:false,httpStatus:null,rawText:null})
  expect(successValue(acceptObservation(data,{envelope:gated,operationId:id(15),nowMs:future+2,lastStartedAtMs:future,nextDueMs:future+900000,alerts:[]})).state.rateLimitedAtMs).toEqual([future])
 })
})
