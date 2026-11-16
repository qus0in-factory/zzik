import {planBackfill,authorizeBackfill,backfillGuard,backfillStatement} from '../../domain/usage/d1-backfill.mjs'
import {migrationRowSha256} from '../../domain/usage/d1-migration.mjs'
/** @param {{source:{events:unknown[],snapshots:unknown[]},destination:import('../../domain/usage/d1-backfill-types.ts').BackfillDestination,checkpoint:import('../../domain/usage/d1-backfill-types.ts').BackfillCheckpointPort,ledgerOutboxCount:number,apply?:boolean,confirmation?:string,batchSize?:number}} options */
export async function runBackfill(options){
 try{
  const planned=planBackfill(options.source);if(!planned.ok)return planned
  const plan=planned.value,authorized=authorizeBackfill(options.apply??false,options.confirmation??'',plan.summary.planSha256)
  if(!authorized.ok)return authorized
  if(options.ledgerOutboxCount!==0)return {ok:false,reason:'ledger_outbox_not_empty'}
  const saved=options.checkpoint.read();if(!saved.ok)return saved
  if(saved.value!==null&&(saved.value.planSha256!==plan.summary.planSha256||!Number.isSafeInteger(saved.value.completed)||saved.value.completed<0||saved.value.completed>plan.items.length))return {ok:false,reason:'checkpoint_plan_mismatch'}
  const state=await options.destination.inspect();if(!state.ok)return state
  if(state.value.receipts!==0||state.value.dirtySnapshots!==0||state.value.dirtyEvents!==0)return {ok:false,reason:'destination_not_backfill_only'}
  if(state.value.maxId!==null&&(state.value.sequence===null||BigInt(state.value.sequence)<BigInt(state.value.maxId)))return {ok:false,reason:'sequence_below_max_id'}
  const existing=new Map();let seenEvents=0,seenSnapshots=0
  for(const kind of /** @type {('event'|'snapshot')[]} */(['event','snapshot'])){
   const items=plan.items.filter(i=>(i.row.id===null)===(kind==='snapshot'))
   if((kind==='event'?state.value.events:state.value.snapshots)===0)continue
   for(let start=0;start<items.length;start+=25){
    const found=await options.destination.read(kind,items.slice(start,start+25).map(i=>i.row.id??i.row.provider));if(!found.ok)return found
    for(const row of found.value){const key=row.id??row.provider;if(existing.has(key))return {ok:false,reason:'duplicate_destination_key'};existing.set(key,row);if(kind==='event')seenEvents++;else seenSnapshots++}
   }
  }
  if(seenEvents!==state.value.events||seenSnapshots!==state.value.snapshots)return {ok:false,reason:'destination_has_unexpected_rows'}
  const pending=[];let matched=0
  for(let index=0;index<plan.items.length;index++){
   const item=plan.items[index],old=existing.get(item.row.id??item.row.provider)
   if(old){const hash=migrationRowSha256(old);if(!hash.ok)return hash
    if(hash.value===item.sha256){matched++;continue}
    if(item.row.id!==null)return {ok:false,reason:'migration_hash_mismatch'}
    if(Date.parse(item.row.runAt)<=Date.parse(old.runAt))return {ok:false,reason:'stale_or_conflicting_snapshot'}
   }
   pending.push({index,item})
  }
  if(!authorized.value)return {ok:true,value:{...plan.summary,dryRun:true,alreadyPresent:matched,written:0,completed:saved.value?.completed??0}}
  const size=options.batchSize??20
  if(!Number.isSafeInteger(size)||size<1||size>20)return {ok:false,reason:'invalid_batch_size'}
  let completed=saved.value?.completed??0,written=0
  for(let offset=0;offset<pending.length;){
   /** @type {import('../../../shared/d1-contract.ts').D1SqlStatement[]} */const batch=[backfillGuard];let end=offset
   for(;end<pending.length&&end-offset<size;end++){
    const sql=backfillStatement(pending[end].item);if(!sql.ok)return sql
    const proposed=[...batch,sql.value]
    if(Buffer.byteLength(JSON.stringify(proposed),'utf8')>512*1024){if(end===offset)return {ok:false,reason:'batch_too_large'};break}
    batch.push(sql.value)
   }
   const result=await options.destination.write(batch);if(!result.ok)return {...result,completed}
   completed=pending[end-1].index+1;written+=end-offset
   const checkpoint=options.checkpoint.write({planSha256:plan.summary.planSha256,completed});if(!checkpoint.ok)return {...checkpoint,completed}
   offset=end
  }
  const final=await options.destination.inspect();if(!final.ok)return final
  if(final.value.receipts!==0||final.value.dirtySnapshots!==0||final.value.dirtyEvents!==0||final.value.events!==plan.summary.events||final.value.snapshots!==plan.summary.snapshots)return {ok:false,reason:'destination_verification_failed'}
  if(plan.summary.maxId!==null&&(final.value.maxId!==plan.summary.maxId||final.value.sequence===null||BigInt(final.value.sequence)<BigInt(plan.summary.maxId)))return {ok:false,reason:'sequence_below_max_id'}
  // Re-read every envelope after writes; checkpoint alone is not proof of migrated contents.
  for(let offset=0;offset<plan.items.length;offset+=25){
   for(const kind of /** @type {('event'|'snapshot')[]} */(['event','snapshot'])){
    const chunk=plan.items.slice(offset,offset+25).filter(i=>(i.row.id===null)===(kind==='snapshot'));if(!chunk.length)continue
    const rows=await options.destination.read(kind,chunk.map(i=>i.row.id??i.row.provider));if(!rows.ok)return rows
    if(rows.value.length!==chunk.length)return {ok:false,reason:'destination_verification_failed'}
    for(const item of chunk){const row=rows.value.find(r=>(r.id??r.provider)===(item.row.id??item.row.provider));const hash=row===undefined?null:migrationRowSha256(row);if(!hash?.ok||hash.value!==item.sha256)return {ok:false,reason:'migration_hash_mismatch'}}
   }
  }
  const checkpoint=options.checkpoint.write({planSha256:plan.summary.planSha256,completed:plan.items.length});if(!checkpoint.ok)return checkpoint
  return {ok:true,value:{...plan.summary,dryRun:false,alreadyPresent:matched,written,completed:plan.items.length}}
 }catch{return {ok:false,reason:'backfill_failed'}}
}
