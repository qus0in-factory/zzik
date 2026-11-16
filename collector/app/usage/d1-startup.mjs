import { reconcileSequence } from '../../domain/usage/d1-ledger.mjs'
/** @param {Array<{id:string,ports:import('../../domain/usage/ports.mjs').CollectorPorts}>} providers @param {import('../../domain/usage/ports.mjs').StateStorePort} prune */
export async function readLegacyLedgerInputs(providers,prune){
 /** @type {Partial<Record<import('../../../shared/usage-contract.ts').UsageProvider,Record<string,unknown>>>} */const legacy={}
 for(const provider of providers){const state=await provider.ports.state.read();if(state!==null&&typeof state==='object')legacy[/** @type {import('../../../shared/usage-contract.ts').UsageProvider} */(provider.id)]=/** @type {Record<string,unknown>} */(state)}
 const state=/** @type {{lastPruneAt?:unknown}|null} */(await prune.read())
 return {legacy,lastPruneAt:state?.lastPruneAt}
}
/** Quiesced read-only remote reconciliation, before the first new provider call.
 * @param {{ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,query:import('../../domain/usage/d1-sender-types.ts').D1QueryPort,providers:import('../../../shared/usage-contract.ts').UsageProvider[],clock:{now():number},notifyAlerts:(alerts:unknown[])=>Promise<void>}} options */
export async function reconcileD1Startup(options){
 for(const provider of options.providers){
  const local=options.ledger.read(provider);if(!local.ok)return local
  const snapshot=await options.query.query([{sql:'SELECT write_seq FROM usage_snapshot WHERE provider=?',params:[provider]}])
  if(!snapshot.ok)return snapshot
  const results=/** @type {{write_seq?:unknown}[]|undefined} */(snapshot.value[0]?.results)
  if(!Array.isArray(results)||results.length>1)return {ok:false,reason:'invalid_snapshot_sequence'}
  const remoteSeq=results[0]?.write_seq??0
  if(typeof remoteSeq!=='number'||!Number.isSafeInteger(remoteSeq)||remoteSeq<0)return {ok:false,reason:'invalid_snapshot_sequence'}
  /** @type {import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts} */const receipts={}
  const rows=local.value.rows
  for(let index=0;index<rows.length;index+=25){
   const chunk=rows.slice(index,index+25),slots=chunk.map(()=>'?').join(',')
   const r=await options.query.query([{sql:`SELECT operation_id,provider,write_seq,payload_sha256,created_at_ms FROM usage_write_receipt WHERE (provider=? AND write_seq IN (${slots})) OR operation_id IN (${slots})`,params:[provider,...chunk.map(row=>row.operation.writeSeq),...chunk.map(row=>row.operation.operationId)]}])
   if(!r.ok)return r
   const found=/** @type {Record<string,unknown>[]|undefined} */(r.value[0]?.results)
   if(!Array.isArray(found))return {ok:false,reason:'invalid_receipt_result'}
   for(const row of chunk){
    const matches=found.filter(f=>f.operation_id===row.operation.operationId||f.provider===provider&&f.write_seq===row.operation.writeSeq)
    if(matches.length>1)return {ok:false,reason:'receipt_conflict'}
    const hit=matches[0]
    receipts[row.operation.operationId]=hit?/** @type {import('../../../shared/d1-contract.ts').D1WriteReceipt} */({operationId:hit.operation_id,provider:hit.provider,writeSeq:hit.write_seq,payloadSha256:hit.payload_sha256,createdAtMs:hit.created_at_ms}):null
   }
  }
  const updated=options.ledger.update(provider,data=>reconcileSequence(data,remoteSeq,receipts));if(!updated.ok)return updated
  const remaining=new Set(updated.value.rows.map(row=>row.operation.operationId))
  for(const row of rows){if(!remaining.has(row.operation.operationId)){const env=JSON.parse(row.operation.envelopeJson),age=options.clock.now()-Date.parse(env.runAt);if(age>=0&&age<=env.intervalSec*1000&&row.alerts.length>0)try{await options.notifyAlerts(row.alerts)}catch{}}}
 }
 return {ok:true,value:undefined}
}
