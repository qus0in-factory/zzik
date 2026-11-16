import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,mkdirSync,chmodSync,openSync,closeSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {migrationTimeKey} from '../../../shared/d1-canonical.ts'
import {prepareBackfillRow,createBackfillAccumulator} from '../../domain/usage/d1-backfill.mjs'
/** @typedef {import('../../domain/usage/d1-backfill-types.ts').BackfillReplayPlan} ReplayPlan */
/** Disk holds row bodies and ordering keys. JS retains only the current page/row.
 * @param {{directory:string,pageSize?:number}} options
 * @returns {import('../../../shared/d1-contract.ts').D1Result<import('../../domain/usage/d1-backfill-types.ts').BackfillSpool>} */
export function createBackfillSpool({directory,pageSize=25}){
 if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>250)return {ok:false,reason:'invalid_page_size'}
 /** @type {DatabaseSync|undefined} */let database
 /** @type {string|undefined} */let ownDirectory
 try{
  mkdirSync(directory,{recursive:true,mode:0o700})
  ownDirectory=mkdtempSync(join(directory,'backfill-plan-'));chmodSync(ownDirectory,0o700)
  const path=join(ownDirectory,'plan.sqlite');closeSync(openSync(path,'wx',0o600))
  database=new DatabaseSync(path);const db=database
  db.exec(`PRAGMA cache_size=-4096;PRAGMA temp_store=FILE;PRAGMA synchronous=FULL;
   CREATE TABLE items(kind INTEGER NOT NULL,k TEXT NOT NULL,sort_id INTEGER,provider TEXT NOT NULL,at_ms INTEGER NOT NULL,micro INTEGER NOT NULL,item_json TEXT NOT NULL,PRIMARY KEY(kind,k)) STRICT;
   CREATE INDEX items_order ON items(kind,sort_id,k);`)
  const insert=db.prepare('INSERT INTO items VALUES(?,?,CAST(? AS INTEGER),?,?,?,?)')
  const eventPage=db.prepare('SELECT k,item_json FROM items WHERE kind=0 AND sort_id>CAST(? AS INTEGER) ORDER BY sort_id LIMIT ?')
  const snapshotPage=db.prepare('SELECT k,item_json FROM items WHERE kind=1 AND k>? ORDER BY k COLLATE BINARY LIMIT ?')
  let closed=false
  /** @type {string|null} */let failure=null
  /** @type {ReplayPlan|null} */let sealed=null
  /** @returns {AsyncGenerator<readonly import('../../domain/usage/d1-backfill-types.ts').BackfillRow[]>} */
  async function* pages(){
   if(closed||sealed===null)throw new Error('plan_unavailable')
   for(const kind of [0,1]){
    let after=kind===0?'0':''
    for(;;){
     const rows=(kind===0?eventPage:snapshotPage).all(after,pageSize)
     if(rows.length===0)break
     yield rows.map(r=>JSON.parse(String(r.item_json)))
     after=String(rows.at(-1)?.k)
     if(rows.length<pageSize)break
    }
   }
  }
  return {ok:true,value:{
   append(kind,rows){
    if(closed||sealed!==null||failure!==null)return {ok:false,reason:failure??'plan_sealed'}
    try{
     db.exec('BEGIN IMMEDIATE')
     for(const input of rows){
      const item=prepareBackfillRow(input,kind)
      if(!item.ok){db.exec('ROLLBACK');failure=item.reason;return item}
      const raw=/** @type {{runAt?:unknown}} */(input),time=migrationTimeKey(raw.runAt)
      if(!time.ok){db.exec('ROLLBACK');failure=time.reason;return time}
      const r=item.value.row
      insert.run(kind==='event'?0:1,r.id??r.provider,r.id,r.provider,time.value.ms,time.value.microRemainder,JSON.stringify(item.value))
     }
     db.exec('COMMIT');return {ok:true,value:undefined}
    }catch{try{db.exec('ROLLBACK')}catch{}failure='spool_write_failed';return {ok:false,reason:failure}}
   },
   seal(){
    if(closed||failure!==null)return {ok:false,reason:failure??'plan_closed'}
    if(sealed!==null)return {ok:true,value:sealed}
    try{
     // Within one provider/ms bucket only the sub-ms remainder can change PG order.
     // Sorting by the original 64-bit integer id makes this equivalent to the A gate.
     const bad=db.prepare('SELECT 1 FROM (SELECT micro,LAG(micro) OVER(PARTITION BY provider,at_ms ORDER BY sort_id) AS previous FROM items WHERE kind=0) WHERE micro<previous LIMIT 1').get()
     if(bad){failure='millisecond_order_changed';return {ok:false,reason:failure}}
     const digest=createBackfillAccumulator()
     for(const row of db.prepare('SELECT item_json FROM items ORDER BY kind,sort_id,k COLLATE BINARY').iterate()){
      const added=digest.append(JSON.parse(String(row.item_json)));if(!added.ok){failure=added.reason;return added}
     }
     const summary=Object.freeze(digest.finish());db.exec('PRAGMA query_only=ON')
     sealed={summary,pages};return {ok:true,value:sealed}
    }catch{failure='spool_read_failed';return {ok:false,reason:failure}}
   },
   close(){if(closed)return;closed=true;try{db.close()}finally{if(ownDirectory!==undefined)rmSync(ownDirectory,{recursive:true,force:true})}},
  }}
 }catch{try{database?.close()}catch{}if(ownDirectory!==undefined)rmSync(ownDirectory,{recursive:true,force:true});return {ok:false,reason:'spool_open_failed'}}
}
