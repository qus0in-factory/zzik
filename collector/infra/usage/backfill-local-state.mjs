import {DatabaseSync} from 'node:sqlite'
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync,chmodSync,openSync,closeSync,fsyncSync} from 'node:fs'
import {join,dirname} from 'node:path'
/** @param {string} path @param {unknown} value */
export function writePrivateJson(path,value){mkdirSync(dirname(path),{recursive:true,mode:0o700});chmodSync(dirname(path),0o700);writeFileSync(path+'.tmp',JSON.stringify(value),{mode:0o600});chmodSync(path+'.tmp',0o600);const fd=openSync(path+'.tmp','r');try{fsyncSync(fd)}finally{closeSync(fd)}renameSync(path+'.tmp',path);const directory=openSync(dirname(path),'r');try{fsyncSync(directory)}finally{closeSync(directory)}}
/** @param {string} path @returns {import('../../domain/usage/d1-backfill-types.ts').BackfillCheckpointPort} */
export function createBackfillCheckpoint(path){return {
 read(){try{const value=JSON.parse(readFileSync(path,'utf8'));if(value===null||typeof value!=='object'||typeof value.planSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.planSha256)||!Number.isSafeInteger(value.completed)||value.completed<0)return {ok:false,reason:'invalid_checkpoint'};return {ok:true,value}}catch(error){return /** @type {{code?:string}} */(error).code==='ENOENT'?{ok:true,value:null}:{ok:false,reason:'checkpoint_read_failed'}}},
 write(value){try{writePrivateJson(path,value);return {ok:true,value:undefined}}catch{return {ok:false,reason:'checkpoint_write_failed'}}},
}}
/** Locks out collector startup for the whole plan/apply. Existing ledger is read-only.
 * @param {string} directory @returns {import('../../../shared/d1-contract.ts').D1Result<{outboxCount:number,close():void}>} */
export function lockBackfillLedger(directory){
 /** @type {DatabaseSync|undefined} */let lock
 /** @type {DatabaseSync|undefined} */let ledger
 try{
  mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700)
  const lockPath=join(directory,'collector-ledger.lock.sqlite');if(!existsSync(lockPath))closeSync(openSync(lockPath,'wx',0o600));lock=new DatabaseSync(lockPath);chmodSync(lockPath,0o600);lock.exec('PRAGMA busy_timeout=0;BEGIN EXCLUSIVE')
  const markerPath=join(directory,'collector-ledger.marker.json'),marker=existsSync(markerPath)?JSON.parse(readFileSync(markerPath,'utf8')):null,path=join(directory,'collector-ledger.sqlite')
  if(marker!==null&&!['active','rolled-back'].includes(marker.status))throw Error('invalid_marker')
  if(!existsSync(path)){if(marker!==null)throw Error('missing_ledger');return {ok:true,value:{outboxCount:0,close:()=>{lock?.exec('ROLLBACK');lock?.close()}}}}
  ledger=new DatabaseSync(path,{readOnly:true})
  if(!['1','rolled-back'].includes(String(ledger.prepare("SELECT value FROM ledger_meta WHERE key='initialized'").get()?.value)))throw Error('invalid_ledger')
  const count=ledger.prepare('SELECT count(*) AS n FROM outbox').get(),n=Number(count?.n)
  if(!Number.isSafeInteger(n)||n<0)throw Error('invalid_ledger')
  ledger.close();ledger=undefined
  return {ok:true,value:{outboxCount:n,close:()=>{lock?.exec('ROLLBACK');lock?.close()}}}
 }catch{try{ledger?.close()}catch{}try{lock?.close()}catch{}return {ok:false,reason:'ledger_preflight_failed'}}
}
