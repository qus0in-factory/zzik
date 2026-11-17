/** Pure transitions. Persistence atomically commits state plus outbox via LedgerPort. */
import { createCollectorD1Write } from './d1-write-contract.mjs'
import { snapshotChanged } from './snapshot-change.mjs'
import { eventHeartbeatDue } from './event-heartbeat.mjs'
import { sha256Hex } from './envelope.mjs'
import { appendRateLimit } from './interval-degrade.mjs'
/** @typedef {import('./d1-ledger-types.ts').LedgerData} Data */
/** @typedef {import('./d1-ledger-types.ts').ReceiptFacts} Receipts */
/** @typedef {import('../../../shared/d1-contract.ts').D1WriteReceipt} Receipt */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */
/** @returns {Data} */
export function initialLedgerState() {
  return {state:{previous:null,lastEventAt:null,remoteCommitted:null,remoteCommittedLastEventAt:null,gate:{nextAllowedAt:null,failReason:null,failCount:0,authFailCount:0,authDeniedExpiresAt:null},alerts:null,lastRun:{status:null,tokenExpiresAt:null},nextSeq:1,ackedSeq:0,revision:0,lastStartedAtMs:null,nextDueMs:null},rows:[]}
}
/** @param {import('../../../shared/usage-contract.ts').UsageEnvelope|null} env */
function fingerprint(env) { return env === null ? null : {status:env.status,rawSha256:env.rawText===null?null:sha256Hex(env.rawText)} }
/** @param {Data['state']} state @param {import('../../../shared/usage-contract.ts').UsageEnvelope} env */
function emits(state,env) { return snapshotChanged(fingerprint(state.previous), /** @type {NonNullable<ReturnType<typeof fingerprint>>} */(fingerprint(env))) || eventHeartbeatDue(state.lastEventAt,Date.parse(env.runAt)) }
/** @param {import('./d1-ledger-types.ts').QueueStats} stats @param {number} nowMs */
export function queueHealth(stats,nowMs) {
  const age=stats.oldestMs===null?0:nowMs-stats.oldestMs
  return {collect:stats.count<25000 && stats.bytes<256*1024*1024 && age<7*86400000,quarantine:age>7*86400000}
}
/** @param {Data} data @param {import('./d1-ledger-types.ts').Observation} input @returns {Result<Data>} */
export function acceptObservation(data,input) {
  if (!Number.isSafeInteger(data.state.nextSeq) || data.state.nextSeq<1 || data.state.nextSeq>=Number.MAX_SAFE_INTEGER) return {ok:false,reason:'sequence_exhausted'}
  if(data.state.nextSeq<=data.state.ackedSeq || data.rows.some(r=>r.operation.writeSeq===data.state.nextSeq))return {ok:false,reason:'sequence_conflict'}
  if (data.rows.some(r=>r.operation.operationId===input.operationId)) return {ok:false,reason:'operation_conflict'}
  const at=Date.parse(input.envelope.runAt)
  if (!Number.isSafeInteger(input.nowMs) || !Number.isFinite(at) || !Number.isSafeInteger(input.lastStartedAtMs) || !Number.isSafeInteger(input.nextDueMs)) return {ok:false,reason:'invalid_observation_time'}
  if(data.state.previous!==null && at<Date.parse(data.state.previous.runAt))return {ok:false,reason:'clock_skew'}
  const emitEvent=emits(data.state,input.envelope)
  const op=createCollectorD1Write({operationId:input.operationId,provider:input.envelope.provider,writeSeq:data.state.nextSeq,envelopeJson:JSON.stringify(input.envelope),emitEvent})
  if(!op.ok)return op
  return {ok:true,value:{state:{...data.state,...(input.envelope.status==='rate_limited' && input.envelope.called ? {rateLimitedAtMs:appendRateLimit(data.state.rateLimitedAtMs,input.nowMs)} : {}),previous:input.envelope,lastEventAt:emitEvent?input.envelope.runAt:data.state.lastEventAt,
    lastRun:{status:input.envelope.status,tokenExpiresAt:input.envelope.tokenExpiresAt===null?null:Date.parse(input.envelope.tokenExpiresAt)},gate:input.gate===undefined?data.state.gate:input.gate,alerts:input.alertBaseline===undefined?data.state.alerts:input.alertBaseline,
    nextSeq:data.state.nextSeq+1,lastStartedAtMs:input.lastStartedAtMs,nextDueMs:input.nextDueMs,revision:data.state.revision+1},
    rows:[...data.rows,{operation:op.value,createdAtMs:input.nowMs,attempts:0,nextAttemptAtMs:input.nowMs,alerts:input.alerts,quarantined:false}]}}
}
/** @param {import('../../../shared/d1-contract.ts').CollectorD1WriteV1} op @param {Receipt} receipt */
function receiptMatches(op,receipt) {return op.operationId===receipt.operationId && op.provider===receipt.provider && op.writeSeq===receipt.writeSeq && op.payloadSha256===receipt.payloadSha256 && Number.isSafeInteger(receipt.createdAtMs)}
/** @param {Data} data @param {Receipt} receipt @returns {Result<Data>} */
export function acknowledgeOperation(data,receipt) {
  const head=data.rows[0]
  if(!head || !receiptMatches(head.operation,receipt))return {ok:false,reason:'receipt_conflict'}
  const env=JSON.parse(head.operation.envelopeJson)
  return {ok:true,value:{state:{...data.state,remoteCommitted:env,remoteCommittedLastEventAt:head.operation.emitEvent?env.runAt:data.state.remoteCommittedLastEventAt,
    ackedSeq:head.operation.writeSeq,revision:data.state.revision+1},rows:data.rows.slice(1)}}
}
/** Explicit receipt facts are required before rewriting accepted bytes. No network or sender.
 * @param {Data} data @param {{operationId:string,mode:'discard_400'|'resume_without_quarantine',receipts:Receipts}} input @returns {Result<Data>} */
export function breakChain(data,input) {
  const index=data.rows.findIndex(r=>r.operation.operationId===input.operationId)
  // The FIFO head alone can be discarded; never skip an uncommitted predecessor.
  if(index!==0)return {ok:false,reason:'not_fifo_head'}
  const dropped=data.rows[index]
  if(!(dropped.operation.operationId in input.receipts))return {ok:false,reason:'receipt_required'}
  if(input.receipts[dropped.operation.operationId]!==null)return {ok:false,reason:'operation_already_committed'}
  if(input.mode==='resume_without_quarantine' && !dropped.quarantined) return {ok:false,reason:'not_quarantined'}
  const rows=data.rows.slice(1).map(r=>({...r}))
  const state={...data.state,previous:data.state.remoteCommitted,lastEventAt:data.state.remoteCommittedLastEventAt,revision:data.state.revision+1}
  if(rows[0]) {
    const next=rows[0], id=next.operation.operationId
    if(!(id in input.receipts))return {ok:false,reason:'receipt_required'}
    if(input.receipts[id]!==null)return {ok:false,reason:'successor_already_committed'}
    const env=JSON.parse(next.operation.envelopeJson)
    const fixed=createCollectorD1Write({...next.operation,emitEvent:emits(state,env)})
    if(!fixed.ok)return fixed
    next.operation=fixed.value
  }
  // Future accepts follow the remaining chain; when empty they use remoteCommitted.
  for(const row of rows) {
    state.previous=JSON.parse(row.operation.envelopeJson)
    if(row.operation.emitEvent)state.lastEventAt=state.previous?.runAt??null
  }
  return {ok:true,value:{state,rows}}
}
/** Reconciliation never invents a replacement seq for a conflicting operation.
 * @param {Data} data @param {number} remoteSeq @param {Receipts} receipts @returns {Result<Data>} */
export function reconcileSequence(data,remoteSeq,receipts) {
  if(!Number.isSafeInteger(remoteSeq)||remoteSeq<0)return {ok:false,reason:'invalid_remote_sequence'}
  for(const row of data.rows) {
    const receipt=receipts[row.operation.operationId]
    if(receipt && !receiptMatches(row.operation,receipt))return {ok:false,reason:'receipt_conflict'}
  }
  const max=Math.max(data.state.nextSeq-1,remoteSeq,...data.rows.map(r=>r.operation.writeSeq))
  if(max>=Number.MAX_SAFE_INTEGER)return {ok:false,reason:'sequence_exhausted'}
  let next=data
  while(next.rows[0] && receipts[next.rows[0].operation.operationId]) {
    const ack=acknowledgeOperation(next,/** @type {Receipt} */(receipts[next.rows[0].operation.operationId]))
    if(!ack.ok)return ack
    next=ack.value
  }
  return {ok:true,value:{...next,state:{...next.state,nextSeq:max+1}}}
}
