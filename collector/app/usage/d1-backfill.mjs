import {planBackfill,authorizeBackfill,backfillGuard,backfillStatement,createBackfillAccumulator} from '../../domain/usage/d1-backfill.mjs'
import {migrationRowSha256} from '../../domain/usage/d1-migration.mjs'
/** @typedef {import('../../domain/usage/d1-backfill-types.ts').BackfillRow} Item */
/** @typedef {import('../../domain/usage/d1-backfill-types.ts').BackfillReplayPlan} ReplayPlan */
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */
/** @param {ReplayPlan} plan */
async function* pages(plan){for await(const page of plan.pages())for(let offset=0;offset<page.length;offset+=25)yield page.slice(offset,offset+25)}
/** All passes use bounded pages. The array adapter keeps the existing public contract.
 * @param {{source:import('../../domain/usage/d1-backfill-types.ts').BackfillInput,destination:import('../../domain/usage/d1-backfill-types.ts').BackfillDestination,checkpoint:import('../../domain/usage/d1-backfill-types.ts').BackfillCheckpointPort,ledgerOutboxCount:number,apply?:boolean,confirmation?:string,batchSize?:number}} options */
export async function runBackfill(options){
 try{
  /** @type {ReplayPlan} */let plan
  if('pages' in options.source)plan=options.source
  else{
   const prepared=planBackfill(options.source);if(!prepared.ok)return prepared
   const original=prepared.value
   plan={summary:original.summary,async *pages(){for(let offset=0;offset<original.items.length;offset+=25)yield original.items.slice(offset,offset+25)}}
  }
  if(plan.sourceFacts&&(plan.summary.events!==plan.sourceFacts.events||plan.summary.snapshots!==plan.sourceFacts.snapshots||plan.summary.minId!==plan.sourceFacts.minId||plan.summary.maxId!==plan.sourceFacts.maxId))return {ok:false,reason:'pg_plan_count_mismatch'}
  const total=plan.summary.events+plan.summary.snapshots
  if(!Number.isSafeInteger(total)||total<0)return {ok:false,reason:'invalid_plan'}
  const authorized=authorizeBackfill(options.apply??false,options.confirmation??'',plan.summary.planSha256);if(!authorized.ok)return authorized
  if(options.ledgerOutboxCount!==0)return {ok:false,reason:'ledger_outbox_not_empty'}
  const saved=options.checkpoint.read();if(!saved.ok)return saved
  if(saved.value!==null&&(saved.value.planSha256!==plan.summary.planSha256||!Number.isSafeInteger(saved.value.completed)||saved.value.completed<0||saved.value.completed>total))return {ok:false,reason:'checkpoint_plan_mismatch'}
  const state=await options.destination.inspect();if(!state.ok)return state
  /** @param {import('../../domain/usage/d1-backfill-types.ts').BackfillFacts} f */
  const clean=f=>f.receipts===0&&f.dirtySnapshots===0&&f.dirtyEvents===0
  if(!clean(state.value))return {ok:false,reason:'destination_not_backfill_only'}
  if(state.value.maxId!==null&&(state.value.sequence===null||BigInt(state.value.sequence)<BigInt(state.value.maxId)))return {ok:false,reason:'sequence_below_max_id'}
  /** @param {readonly Item[]} items @param {boolean} strict @returns {Promise<Result<{needed:{item:Item,offset:number}[],matched:number,seenEvents:number,seenSnapshots:number}>>} */
  const comparePage=async(items,strict)=>{
   const old=new Map();let seenEvents=0,seenSnapshots=0,matched=0
   for(const kind of /** @type {('event'|'snapshot')[]} */(['event','snapshot'])){
    const group=items.filter(i=>(i.row.id===null)===(kind==='snapshot'));if(!group.length)continue
    if(!strict&&(kind==='event'?state.value.events:state.value.snapshots)===0)continue
    const found=await options.destination.read(kind,group.map(i=>i.row.id??i.row.provider));if(!found.ok)return found
    const allowed=new Set(group.map(i=>i.row.id??i.row.provider))
    for(const row of found.value){const key=row.id??row.provider;if(old.has(key)||!allowed.has(key))return {ok:false,reason:'duplicate_destination_key'};old.set(key,row);if(kind==='event')seenEvents++;else seenSnapshots++}
   }
   /** @type {{item:Item,offset:number}[]} */const needed=[]
   for(let offset=0;offset<items.length;offset++){
    const item=items[offset],previous=old.get(item.row.id??item.row.provider)
    if(previous){const hash=migrationRowSha256(previous);if(!hash.ok)return hash
     if(hash.value===item.sha256){matched++;continue}
     if(strict||item.row.id!==null)return {ok:false,reason:'migration_hash_mismatch'}
     if(Date.parse(item.row.runAt)<=Date.parse(previous.runAt))return {ok:false,reason:'stale_or_conflicting_snapshot'}
    }else if(strict)return {ok:false,reason:'destination_verification_failed'}
    needed.push({item,offset})
   }
   return {ok:true,value:{needed,matched,seenEvents,seenSnapshots}}
  }
  // Validate every source hash and destination conflict before issuing any writes.
  const digest=createBackfillAccumulator();let seenEvents=0,seenSnapshots=0,matched=0
  for await(const page of pages(plan)){
   for(const item of page){const added=digest.append(item);if(!added.ok)return added}
   const compared=await comparePage(page,false);if(!compared.ok)return compared
   seenEvents+=compared.value.seenEvents;seenSnapshots+=compared.value.seenSnapshots;matched+=compared.value.matched
  }
  const actual=digest.finish()
  if(actual.planSha256!==plan.summary.planSha256||actual.events!==plan.summary.events||actual.snapshots!==plan.summary.snapshots||actual.minId!==plan.summary.minId||actual.maxId!==plan.summary.maxId)return {ok:false,reason:'source_plan_mismatch'}
  if(seenEvents!==state.value.events||seenSnapshots!==state.value.snapshots)return {ok:false,reason:'destination_has_unexpected_rows'}
  if(!authorized.value)return {ok:true,value:{...plan.summary,dryRun:true,alreadyPresent:matched,written:0,completed:saved.value?.completed??0}}
  const size=options.batchSize??20
  if(!Number.isSafeInteger(size)||size<1||size>20)return {ok:false,reason:'invalid_batch_size'}
  let completed=saved.value?.completed??0,written=0,batchCount=0,lastIndex=-1,index=0
  /** @type {import('../../../shared/d1-contract.ts').D1SqlStatement[]} */let batch=[backfillGuard]
  /** @returns {Promise<Result<void>>} */
  const flush=async()=>{
   if(batchCount===0)return {ok:true,value:undefined}
   const result=await options.destination.write(batch);if(!result.ok)return result
   completed=lastIndex+1;written+=batchCount
   const checkpoint=options.checkpoint.write({planSha256:plan.summary.planSha256,completed});if(!checkpoint.ok)return checkpoint
   batch=[backfillGuard];batchCount=0;return {ok:true,value:undefined}
  }
  for await(const page of pages(plan)){
   const compared=await comparePage(page,false);if(!compared.ok)return compared
   for(const entry of compared.value.needed){
    const sql=backfillStatement(entry.item);if(!sql.ok)return sql
    if(batchCount>0&&(batchCount>=size||Buffer.byteLength(JSON.stringify([...batch,sql.value]),'utf8')>512*1024)){const sent=await flush();if(!sent.ok)return {...sent,completed}}
    if(Buffer.byteLength(JSON.stringify([...batch,sql.value]),'utf8')>512*1024)return {ok:false,reason:'batch_too_large'}
    batch.push(sql.value);batchCount++;lastIndex=index+entry.offset
   }
   index+=page.length
  }
  const sent=await flush();if(!sent.ok)return {...sent,completed}
  if(index!==total)return {ok:false,reason:'source_plan_mismatch'}
  const final=await options.destination.inspect();if(!final.ok)return final
  if(!clean(final.value)||final.value.events!==plan.summary.events||final.value.snapshots!==plan.summary.snapshots)return {ok:false,reason:'destination_verification_failed'}
  if(plan.summary.maxId!==null&&(final.value.maxId!==plan.summary.maxId||final.value.sequence===null||BigInt(final.value.sequence)<BigInt(plan.summary.maxId)))return {ok:false,reason:'sequence_below_max_id'}
  let verified=0
  for await(const page of pages(plan)){const checked=await comparePage(page,true);if(!checked.ok)return checked;verified+=page.length}
  if(verified!==total)return {ok:false,reason:'source_plan_mismatch'}
  const checkpoint=options.checkpoint.write({planSha256:plan.summary.planSha256,completed:total});if(!checkpoint.ok)return checkpoint
  return {ok:true,value:{...plan.summary,dryRun:false,alreadyPresent:matched,written,completed:total}}
 }catch{return {ok:false,reason:'backfill_failed'}}
}
