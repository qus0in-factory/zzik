/** Called under the ledger process lock, before the resident loop starts. No provider calls.
 * @param {{mode:string,provider:import('../../../shared/usage-contract.ts').UsageProvider,ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,query:import('../../domain/usage/d1-sender-types.ts').D1QueryPort,resume:(provider:import('../../../shared/usage-contract.ts').UsageProvider,facts:import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts)=>{ok:boolean,reason?:string}}} options
 * @returns {Promise<import('../../../shared/d1-contract.ts').D1Result<void>>} */
export async function resumeQuarantinedProvider(options){
 if(options.mode!=='d1')return {ok:false,reason:'resume_requires_d1'}
 const read=options.ledger.read(options.provider);if(!read.ok)return read
 const rows=read.value.rows.slice(0,2)
 if(!rows[0]?.quarantined)return {ok:false,reason:'not_quarantined'}
 const slots=rows.map(()=>'?').join(',')
 const checked=await options.query.query([{sql:`SELECT operation_id FROM usage_write_receipt WHERE operation_id IN (${slots}) OR (provider=? AND write_seq IN (${slots}))`,params:[...rows.map(r=>r.operation.operationId),options.provider,...rows.map(r=>r.operation.writeSeq)]}])
 if(!checked.ok)return checked
 const receipts=checked.value[0]?.results
 if(!Array.isArray(receipts))return {ok:false,reason:'invalid_receipt_result'}
 if(receipts.length>0)return {ok:false,reason:'receipt_exists'}
 /** @type {import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts} */const facts={}
 for(const row of rows)facts[row.operation.operationId]=null
 const result=options.resume(options.provider,facts)
 return result.ok?{ok:true,value:undefined}:{ok:false,reason:result.reason??'resume_failed'}
}
