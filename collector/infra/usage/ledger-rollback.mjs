import {DatabaseSync} from 'node:sqlite'
import {join} from 'node:path'
import {existsSync} from 'node:fs'
import {USAGE_PROVIDERS} from '../../domain/usage/providers.mjs'
import {lockBackfillLedger,writePrivateJson} from './backfill-local-state.mjs'
import {ledgerToLegacyState} from '../../domain/usage/d1-legacy-state.mjs'
import {classifyD1Operation} from '../../domain/usage/d1-reconciliation.mjs'
/** Called only after the caller has committed/verified PG reverse migration and drained every operation.
 * @param {{directory:string,pgCommitted:Record<string,{previous:unknown,lastEventAt:string|null}>,receipts:import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts}} options */
export async function finalizeLedgerRollback(options){
 const locked=lockBackfillLedger(options.directory);if(!locked.ok)return locked
 /** @type {DatabaseSync|undefined} */let db
 let transaction=false,committed=false
 try{
  const path=join(options.directory,'collector-ledger.sqlite')
  if(!existsSync(path))return {ok:false,reason:'ledger_missing'}
  db=new DatabaseSync(path)
  const status=db.prepare("SELECT value FROM ledger_meta WHERE key='initialized'").get()?.value
  /** @type {Record<string,{providerState:unknown,pruneState:unknown}>} */let projections={}
  if(status==='rolled-back'){
   projections=JSON.parse(String(db.prepare("SELECT value FROM ledger_meta WHERE key='rollback_json'").get()?.value));committed=true
  }else{
   if(status!=='1')return {ok:false,reason:'invalid_ledger'}
   db.exec('BEGIN IMMEDIATE');transaction=true
   const prune=JSON.parse(String(db.prepare("SELECT value FROM ledger_meta WHERE key='prune'").get()?.value))
   for(const r of db.prepare('SELECT payload_json FROM outbox').all()){
    const operation=JSON.parse(String(r.payload_json)),receipt=options.receipts[operation.operationId]
    if(!receipt){db.exec('ROLLBACK');transaction=false;return {ok:false,reason:'undrained_outbox'}}
    const checked=classifyD1Operation({operation,receipt,outboxPresent:true});if(!checked.ok){db.exec('ROLLBACK');transaction=false;return checked}
   }
   for(const row of db.prepare('SELECT provider,state_json FROM provider_state').all()){
    const provider=String(row.provider),state=JSON.parse(String(row.state_json))
    const fact=options.pgCommitted[provider]??(state.previous===null&&state.remoteCommitted===null?{previous:null,lastEventAt:null}:null)
    if(fact===null){db.exec('ROLLBACK');transaction=false;return {ok:false,reason:'missing_pg_commit_fact'}}
    const projection=ledgerToLegacyState({...state,provider,lastPruneAt:prune.lastPruneAt},{...fact,provider})
    if(!projection.ok){db.exec('ROLLBACK');transaction=false;return projection}
    projections[provider]=projection.value
    const max=db.prepare('SELECT max(write_seq) AS seq FROM outbox WHERE provider=?').get(provider)?.seq
    const ackedSeq=Math.max(state.ackedSeq,Number(max??0)),next={...state,previous:fact.previous,lastEventAt:fact.lastEventAt,remoteCommitted:fact.previous,remoteCommittedLastEventAt:fact.lastEventAt,ackedSeq,revision:state.revision+1}
    db.prepare('UPDATE provider_state SET state_json=?,acked_seq=?,revision=? WHERE provider=?').run(JSON.stringify(next),ackedSeq,next.revision,provider)
   }
   if(Object.keys(projections).length!==USAGE_PROVIDERS.length)throw Error('invalid_provider_set')
   db.exec('DELETE FROM outbox')
   db.prepare("INSERT INTO ledger_meta(key,value) VALUES('rollback_json',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(projections))
   db.exec("UPDATE ledger_meta SET value='rolled-back' WHERE key='initialized';COMMIT");transaction=false;committed=true
  }
  // Files mirror the committed transaction. A crash here is resumed from rollback_json;
  // an external active marker plus initialized=rolled-back fails collector startup closed.
  if(Object.keys(projections).length!==USAGE_PROVIDERS.length||!Object.keys(projections).every(provider=>USAGE_PROVIDERS.includes(provider)))throw Error('invalid_provider_set')
  for(const [provider,projection] of Object.entries(projections))writePrivateJson(join(options.directory,`usage-state.${provider}.json`),projection.providerState)
  const first=Object.values(projections)[0];if(first)writePrivateJson(join(options.directory,'usage-prune.json'),first.pruneState)
  writePrivateJson(join(options.directory,'collector-ledger.marker.json'),{status:'rolled-back'})
  return {ok:true,value:{providers:Object.keys(projections).length}}
 }catch{if(transaction)try{db?.exec('ROLLBACK')}catch{}return {ok:false,reason:committed?'rollback_files_pending':'rollback_failed'}}
 finally{db?.close();locked.value.close()}
}
