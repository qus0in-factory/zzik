/** Opt-in module only: never imported by main/runCycle. No credentials or network. */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync, renameSync, statSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { initialLedgerState, queueHealth } from '../../domain/usage/d1-ledger.mjs'
import { validateCollectorD1Write } from '../../domain/usage/d1-write-contract.mjs'
import { parseD1Envelope } from '../../../shared/d1-canonical.ts'
import { USAGE_PROVIDERS } from '../../domain/usage/providers.mjs'
/** @typedef {import('../../domain/usage/d1-ledger-types.ts').LedgerData} Data */
/** @typedef {import('../../domain/usage/d1-ledger-types.ts').LedgerPort} Ledger */
/** @typedef {import('../../../shared/usage-contract.ts').UsageProvider} Provider */
const PROVIDERS = /** @type {Provider[]} */ (USAGE_PROVIDERS)
/** @template T @typedef {import('../../../shared/d1-contract.ts').D1Result<T>} Result */
/** @param {string} path @param {unknown} data */
function atomicJson(path,data) {
  const temp=path+'.tmp'
  writeFileSync(temp,JSON.stringify(data),{mode:0o600})
  const fd=openSync(temp,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temp,path)
}
/** @param {unknown} value */
function validTime(value){return typeof value==='string' && Number.isFinite(Date.parse(value))}
/** @param {{directory:string,nowMs:number,legacy?:Partial<Record<Provider,Record<string,unknown>>>,lastPruneAt?:unknown,databaseFactory?:(path:string)=>DatabaseSync}} options
 * @returns {Result<Ledger> | {ok:false,reason:string,exitCode:78}} */
export function openSqliteLedger(options) {
  const {directory,nowMs,legacy,lastPruneAt}=options
  const originalUmask=process.umask(0o077)
  /** @type {DatabaseSync|undefined} */ let lock
  /** @type {DatabaseSync|undefined} */ let db
  let closed=false,failed=false
  const path=join(directory,'collector-ledger.sqlite'), marker=join(directory,'collector-ledger.marker.json')
  const cleanup=()=>{if(closed)return;closed=true;try{db?.close()}finally{try{lock?.exec('ROLLBACK')}catch{}lock?.close()}}
  try {
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700)
    const lockPath=join(directory,'collector-ledger.lock.sqlite')
    if(!existsSync(lockPath))closeSync(openSync(lockPath,'wx',0o600))
    lock=new DatabaseSync(lockPath);chmodSync(lockPath,0o600)
    try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')}catch{cleanup();return {ok:false,reason:'already_running',exitCode:78}}
    const markerValue=existsSync(marker)?JSON.parse(readFileSync(marker,'utf8')):null
    if(markerValue!==null && !['active','rolled-back'].includes(markerValue.status))throw new Error('invalid_marker')
    if(markerValue?.status==='rolled-back') {
      if(!legacy || Object.keys(legacy).length===0)throw new Error('rollback_json_missing')
      // Archive without opening the rolled-back database, including its journal files.
      for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))renameSync(path+suffix,path+`.rolled-back-${nowMs}`+suffix)
    }
    const active=markerValue?.status==='active'
    if(active && (!existsSync(path)||statSync(path).size===0))throw new Error('ledger_missing')
    // No marker + an existing DB is a crash between the SQLite commit and marker rename.
    const existing=existsSync(path) && statSync(path).size>0
    if(!existing && !active) {
      for(const provider of PROVIDERS) {
        const previous=legacy?.[provider]?.previous??null
        if(previous!==null){const parsed=parseD1Envelope(JSON.stringify(previous));if(!parsed.ok || parsed.value.provider!==provider)throw new Error('invalid_legacy')}
      }
    }
    if(!existsSync(path))closeSync(openSync(path,'wx',0o600))
    db=(options.databaseFactory??(p=>new DatabaseSync(p)))(path)
    chmodSync(path,0o600)
    if(existing || active) {
      const meta=db.prepare("SELECT value FROM ledger_meta WHERE key='initialized'").get()
      const count=db.prepare('SELECT count(*) AS n FROM provider_state').get()
      if(meta?.value!=='1' || Number(count?.n)!==PROVIDERS.length)throw new Error('empty_ledger')
      if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new Error('corrupt_ledger')
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0')
    if(!existing && !active) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE ledger_meta(key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL) STRICT;
        CREATE TABLE provider_state(provider TEXT PRIMARY KEY NOT NULL,state_json TEXT NOT NULL CHECK(json_valid(state_json)),revision INTEGER NOT NULL,next_seq INTEGER NOT NULL,acked_seq INTEGER NOT NULL,last_started_at_ms INTEGER,next_due_ms INTEGER) STRICT;
        CREATE TABLE outbox(operation_id TEXT PRIMARY KEY NOT NULL,provider TEXT NOT NULL REFERENCES provider_state(provider),write_seq INTEGER NOT NULL,payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),payload_sha256 TEXT NOT NULL,created_at_ms INTEGER NOT NULL,attempts INTEGER NOT NULL,next_attempt_at_ms INTEGER NOT NULL,alert_json TEXT NOT NULL CHECK(json_valid(alert_json)),quarantined INTEGER NOT NULL CHECK(quarantined IN(0,1)),UNIQUE(provider,write_seq)) STRICT;`)
      for(const provider of PROVIDERS) {
        const data=initialLedgerState(), imported=legacy?.[provider]
        if(imported) {
          const previous=imported.previous??null, lastEventAt=validTime(imported.lastEventAt)?/** @type {string} */(imported.lastEventAt):null
          Object.assign(data.state,{previous,remoteCommitted:previous,lastEventAt,remoteCommittedLastEventAt:lastEventAt,gate:imported.gate??data.state.gate,alerts:imported.alerts??null,lastRun:imported.lastRun??data.state.lastRun})
        }
        db.prepare('INSERT INTO provider_state VALUES(?,?,?,?,?,?,?)').run(provider,JSON.stringify(data.state),0,1,0,null,null)
      }
      db.prepare('INSERT INTO ledger_meta VALUES(?,?)').run('prune',JSON.stringify({lastPruneAt:validTime(lastPruneAt)?lastPruneAt:null,skipFirstPrune:!validTime(lastPruneAt)}))
      db.prepare('INSERT INTO ledger_meta VALUES(?,?)').run('initialized','1')
      db.exec('COMMIT')
    }
    const conn=db
    /** @param {Provider} provider @returns {Data} */
    const load=provider=>{
      const row=conn.prepare('SELECT state_json FROM provider_state WHERE provider=?').get(provider)
      if(!row)throw new Error('unknown_provider')
      const state=JSON.parse(String(row.state_json))
      for(const key of ['previous','remoteCommitted']) {
        if(state[key]!==null){const parsed=parseD1Envelope(JSON.stringify(state[key]));if(!parsed.ok || parsed.value.provider!==provider)throw new Error('corrupt_state')}
      }
      for(const key of ['lastEventAt','remoteCommittedLastEventAt'])if(state[key]!==null && !validTime(state[key]))throw new Error('corrupt_state')
      const rows=conn.prepare('SELECT * FROM outbox WHERE provider=? ORDER BY write_seq').all(provider).map(r=>{
        const operation=JSON.parse(String(r.payload_json)), checked=validateCollectorD1Write(operation)
        if(!checked.ok || operation.payloadSha256!==r.payload_sha256 || operation.operationId!==r.operation_id || operation.writeSeq!==r.write_seq || operation.provider!==provider)throw new Error('corrupt_outbox')
        return {operation:checked.value,createdAtMs:Number(r.created_at_ms),attempts:Number(r.attempts),nextAttemptAtMs:Number(r.next_attempt_at_ms),alerts:JSON.parse(String(r.alert_json)),quarantined:r.quarantined===1}
      })
      if(!Number.isSafeInteger(state.nextSeq)||state.nextSeq<1||!Number.isSafeInteger(state.ackedSeq)||state.ackedSeq<0)throw new Error('corrupt_state')
      return {state,rows}
    }
    const stats=()=>{
      const r=conn.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(payload_json AS BLOB))+length(CAST(alert_json AS BLOB))),0) AS bytes,min(created_at_ms) AS oldest FROM outbox WHERE quarantined=0').get()
      return {count:Number(r?.n),bytes:Number(r?.bytes),oldestMs:r?.oldest===null?null:Number(r?.oldest)}
    }
    for(const provider of PROVIDERS)load(provider)
    for(const suffix of ['-wal','-shm'])if(existsSync(path+suffix))chmodSync(path+suffix,0o600)
    atomicJson(marker,{status:'active'})
    const dirFd=openSync(directory,'r');try{fsyncSync(dirFd)}finally{closeSync(dirFd)}
    /** @template T @param {()=>T} fn @returns {Result<T>} */
    const read=fn=>{try{if(closed)throw new Error('closed');return {ok:true,value:fn()}}catch{return {ok:false,reason:'ledger_read_failed'}}}
    /** @type {Ledger} */
    const port={
      read:provider=>read(()=>load(provider)),
      stats:()=>read(stats),
      pruneState:()=>read(()=>JSON.parse(String(conn.prepare("SELECT value FROM ledger_meta WHERE key='prune'").get()?.value))),
      checkpointPrune({kind,atMs}){
        if(failed||closed)return {ok:false,reason:'local_commit_failed'}
        if(!Number.isSafeInteger(atMs)||!Number.isFinite(new Date(atMs).getTime())||!['skipped','completed'].includes(kind))return {ok:false,reason:'invalid_prune_checkpoint'}
        try{
          conn.exec('BEGIN IMMEDIATE')
          const current=JSON.parse(String(conn.prepare("SELECT value FROM ledger_meta WHERE key='prune'").get()?.value))
          const validLast=typeof current.lastPruneAt==='string'&&Number.isFinite(Date.parse(current.lastPruneAt))
          const next=kind==='completed'?{lastPruneAt:new Date(atMs).toISOString(),skipFirstPrune:false}:(current.skipFirstPrune||(current.skippedAtMs===undefined&&!validLast))?{lastPruneAt:current.lastPruneAt,skipFirstPrune:false,skippedAtMs:atMs}:current
          conn.prepare("UPDATE ledger_meta SET value=? WHERE key='prune'").run(JSON.stringify(next));conn.exec('COMMIT')
          return {ok:true,value:undefined}
        }catch{try{conn.exec('ROLLBACK')}catch{}failed=true;return {ok:false,reason:'local_commit_failed'}}
      },
      update(provider,transition){
        if(failed||closed)return {ok:false,reason:'local_commit_failed'}
        try {
          conn.exec('BEGIN IMMEDIATE')
          const before=load(provider),next=transition(structuredClone(before))
          if(!next.ok){conn.exec('ROLLBACK');return next}
          const added=next.value.rows.length>before.rows.length
          if(added && !queueHealth(stats(),Math.max(nowMs,...next.value.rows.map(r=>r.createdAtMs))).collect){conn.exec('ROLLBACK');return {ok:false,reason:'queue_limit'}}
          const ids=new Set(),seqs=new Set()
          for(const row of next.value.rows) {
            const original=before.rows.find(r=>r.operation.operationId===row.operation.operationId)
            if((original && original.operation.writeSeq!==row.operation.writeSeq) || before.rows.some(r=>r.operation.writeSeq===row.operation.writeSeq && r.operation.operationId!==row.operation.operationId)){conn.exec('ROLLBACK');return {ok:false,reason:'sequence_conflict'}}
            const checked=validateCollectorD1Write(row.operation)
            if(!checked.ok || row.operation.provider!==provider || ids.has(row.operation.operationId)||seqs.has(row.operation.writeSeq)) {
              conn.exec('ROLLBACK');return {ok:false,reason:'sequence_conflict'}
            }
            ids.add(row.operation.operationId);seqs.add(row.operation.writeSeq)
          }
          for(const row of before.rows)if(!ids.has(row.operation.operationId))conn.prepare('DELETE FROM outbox WHERE operation_id=?').run(row.operation.operationId)
          for(const row of next.value.rows){
            const op=row.operation
            conn.prepare(`INSERT INTO outbox VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256,attempts=excluded.attempts,next_attempt_at_ms=excluded.next_attempt_at_ms,alert_json=excluded.alert_json,quarantined=excluded.quarantined`).run(op.operationId,provider,op.writeSeq,JSON.stringify(op),op.payloadSha256,row.createdAtMs,row.attempts,row.nextAttemptAtMs,JSON.stringify(row.alerts),row.quarantined?1:0)
          }
          if(added && (stats().bytes>256*1024*1024 || stats().count>25000)){conn.exec('ROLLBACK');return {ok:false,reason:'queue_limit'}}
          const s=next.value.state
          conn.prepare('UPDATE provider_state SET state_json=?,revision=?,next_seq=?,acked_seq=?,last_started_at_ms=?,next_due_ms=? WHERE provider=?').run(JSON.stringify(s),s.revision,s.nextSeq,s.ackedSeq,s.lastStartedAtMs,s.nextDueMs,provider)
          conn.exec('COMMIT');return next
        }catch{try{conn.exec('ROLLBACK')}catch{}failed=true;return {ok:false,reason:'local_commit_failed'}}
      },
      quarantine(at){
        if(failed||closed)return {ok:false,reason:'local_commit_failed'}
        try{const r=conn.prepare('UPDATE outbox SET quarantined=1 WHERE created_at_ms<? AND quarantined=0').run(at-7*86400000);return {ok:true,value:Number(r.changes)}}catch{failed=true;return {ok:false,reason:'local_commit_failed'}}
      },
      pending(at){return read(()=>{
        // Only one FIFO head per provider. Old or quarantined heads block successors.
        return PROVIDERS.flatMap(provider=>{const head=load(provider).rows[0];return head && !head.quarantined && at-head.createdAtMs<=7*86400000 && head.nextAttemptAtMs<=at?[head]:[]})
      })},
      close:cleanup,
    }
    return {ok:true,value:port}
  }catch{cleanup();return {ok:false,reason:'ledger_start_failed',exitCode:78}}
  finally{process.umask(originalUmask)}
}
