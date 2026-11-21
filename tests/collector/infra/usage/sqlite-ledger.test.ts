import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, statSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { openSqliteLedger } from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import { createCollectorD1Write } from '../../../../collector/domain/usage/d1-write-contract.mjs'
import { acceptObservation } from '../../../../collector/domain/usage/d1-ledger.mjs'
import { D1_NOW, d1Envelope, successValue } from '../../../fakes/d1-contract'
const dirs:string[]=[]
const close:Array<()=>void>=[]
function dir(){const d=mkdtempSync(join(tmpdir(),'zzik-ledger-'));dirs.push(d);return d}
const now=Date.parse(D1_NOW)
function open(path:string,extra:Record<string,unknown>={}){const l=successValue(openSqliteLedger({directory:path,nowMs:now,...extra}));close.push(()=>l.close());return l}
const add=(l:ReturnType<typeof open>,n=1,rawText='{}')=>l.update('claude',data=>acceptObservation(data,{operationId:`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`,envelope:d1Envelope({rawText}),nowMs:now,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]}))
afterEach(()=>{close.splice(0).forEach(f=>f());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}))})
describe('Given a private SQLite WAL ledger and a process-lifetime lock',()=>{
 it('When first boot, legacy import and subsequent boot occur Then imports once and keeps state and lastPruneAt',()=>{
  const d=dir(),previous=d1Envelope()
  const l=open(d,{legacy:{claude:{previous,lastEventAt:D1_NOW,gate:{failCount:2},alerts:{a:1},lastRun:{status:'ok'}}},lastPruneAt:D1_NOW})
  expect(successValue(l.read('claude')).state).toMatchObject({previous,remoteCommitted:previous,lastEventAt:D1_NOW,gate:{failCount:2}})
  expect(successValue(l.pruneState())).toEqual({lastPruneAt:D1_NOW,skipFirstPrune:false})
  successValue(add(l));l.close()
  const next=open(d,{legacy:{claude:{previous:null}}})
  expect(successValue(next.read('claude')).rows).toHaveLength(1)
  expect(statSync(join(d,'collector-ledger.sqlite')).mode&0o777).toBe(0o600)
  expect(statSync(d).mode&0o777).toBe(0o700)
 })
 it('When rolled-back marker exists Then archives old ledger without deleting it, imports rollback JSON and writes active marker; absent JSON stops',()=>{
  const d=dir(),l=open(d);l.close()
  writeFileSync(join(d,'collector-ledger.marker.json'),JSON.stringify({status:'rolled-back'}))
  writeFileSync(join(d,'collector-ledger.sqlite'),'old damaged ledger')
  expect(openSqliteLedger({directory:d,nowMs:now}).ok).toBe(false)
  const next=open(d,{legacy:{claude:{previous:d1Envelope(),lastEventAt:D1_NOW}},lastPruneAt:D1_NOW})
  expect(successValue(next.read('claude')).state.remoteCommitted).toEqual(d1Envelope())
  expect(existsSync(join(d,`collector-ledger.sqlite.rolled-back-${now}`))).toBe(true)
  expect(JSON.parse(readFileSync(join(d,'collector-ledger.marker.json'),'utf8'))).toEqual({status:'active'})
 })
 it('When active marker has missing, empty or corrupt ledger Then fails closed without replacing it',()=>{
  for(const bytes of [null,'','not sqlite']){const d=dir();writeFileSync(join(d,'collector-ledger.marker.json'),JSON.stringify({status:'active'}));if(bytes!==null)writeFileSync(join(d,'collector-ledger.sqlite'),bytes);expect(openSqliteLedger({directory:d,nowMs:now}).ok).toBe(false)}
 })
 it('When SQLite is physically valid but its previous envelope is corrupt Then fails closed',()=>{
  const d=dir(),l=open(d);l.close()
  const db=new DatabaseSync(join(d,'collector-ledger.sqlite'))
  db.exec(`UPDATE provider_state SET state_json=json_set(state_json,'$.previous',json('{}')) WHERE provider='claude'`);db.close()
  expect(openSqliteLedger({directory:d,nowMs:now})).toMatchObject({ok:false,reason:'ledger_start_failed'})
 })
 it('When prune timestamp is absent or broken Then records skip-first-prune rather than pruning immediately',()=>{
  for(const at of [undefined,'broken'])expect(successValue(open(dir(),{lastPruneAt:at}).pruneState())).toEqual({lastPruneAt:null,skipFirstPrune:true})
 })
 it('When the first unknown prune cycle is skipped Then persists a distinct skip checkpoint; successful prune persists its real time',()=>{
  const d=dir(),l=open(d)
  successValue(l.checkpointPrune({kind:'skipped',atMs:now}));l.close()
  const next=open(d)
  expect(successValue(next.pruneState())).toEqual({lastPruneAt:null,skipFirstPrune:false,skippedAtMs:now})
  successValue(next.checkpointPrune({kind:'skipped',atMs:now+1000}))
  expect(successValue(next.pruneState()).skippedAtMs).toBe(now)
  successValue(next.checkpointPrune({kind:'completed',atMs:now+86400000}))
  expect(successValue(next.pruneState())).toEqual({lastPruneAt:new Date(now+86400000).toISOString(),skipFirstPrune:false})
 })
 it('When another owner starts Then returns exit 78; closing releases the lock',()=>{
  const d=dir(),l=open(d)
  expect(openSqliteLedger({directory:d,nowMs:now})).toMatchObject({ok:false,reason:'already_running',exitCode:78})
  l.close();expect(open(d)).toBeDefined()
 })
 for(const corrupt of ['{broken','null','[]','{"prune_failed":"yesterday"}'])it(`When maintenance notice metadata is corrupt (${corrupt}) Then skips notices without stopping observation commits`,()=>{
  let db:DatabaseSync|undefined
  const l=open(dir(),{databaseFactory:(p:string)=>{db=new DatabaseSync(p);return db}})
  db!.prepare("INSERT INTO ledger_meta(key,value) VALUES('maintenance_notices',?)").run(corrupt)
  expect(l.claimMaintenanceNotice('prune_failed',now)).toMatchObject({ok:false})
  expect(add(l)).toMatchObject({ok:true})
  expect(successValue(l.read('claude')).rows).toHaveLength(1)
  expect(l.claimMaintenanceNotice('prune_failed',now+86400000)).toMatchObject({ok:false})
  expect(add(l,2)).toMatchObject({ok:true})
  expect(db!.prepare("SELECT value FROM ledger_meta WHERE key='maintenance_notices'").get()!.value).toBe(corrupt)
 })
 it('When SQLite runs out of pages at local commit Then rolls back state and queue and stops further acceptance',()=>{
  let db:DatabaseSync|undefined
  const l=open(dir(),{databaseFactory:(p:string)=>{db=new DatabaseSync(p);return db}})
  successValue(add(l))
  const before=successValue(l.read('claude'))
  db!.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  const count=db!.prepare('PRAGMA page_count').get()!.page_count
  db!.exec(`PRAGMA max_page_count=${count}`)
  expect(add(l,2,'x'.repeat(100000))).toMatchObject({ok:false,reason:'local_commit_failed'})
  expect(successValue(l.read('claude'))).toEqual(before)
  expect(add(l,3)).toMatchObject({ok:false,reason:'local_commit_failed'})
 })
 it('When another process owns the ledger Then a child process cannot acquire it and reports exit 78',()=>{
  const d=dir();open(d)
  const modulePath=new URL('../../../../collector/infra/usage/sqlite-ledger.mjs',import.meta.url).href
  const script=`import {openSqliteLedger} from ${JSON.stringify(modulePath)}; const r=openSqliteLedger({directory:${JSON.stringify(d)},nowMs:${now}});if(r.ok){r.value.close();process.exit(1)}process.exit(r.exitCode===78&&r.reason==='already_running'?0:2)`
  expect(spawnSync(process.execPath,['--input-type=module','-e',script]).status).toBe(0)
 })
 it('When no marker exists with an existing SQLite file Then treats it as a crash before marker rename and recovers without reimporting JSON',()=>{
  const d=dir(),l=open(d);successValue(add(l));l.close()
  rmSync(join(d,'collector-ledger.marker.json'))
  expect(successValue(open(d,{legacy:{claude:{previous:null}}}).read('claude')).rows).toHaveLength(1)
  expect(JSON.parse(readFileSync(join(d,'collector-ledger.marker.json'),'utf8'))).toEqual({status:'active'})
 })
 it('When first open fails with an invalid legacy envelope Then active marker is not written and re-opening with a valid envelope re-imports',()=>{
  const d=dir()
  expect(openSqliteLedger({directory:d,nowMs:now,legacy:{claude:{previous:{provider:'claude'}}}})).toMatchObject({ok:false,reason:'ledger_start_failed',exitCode:78})
  expect(existsSync(join(d,'collector-ledger.marker.json'))).toBe(false)
  const next=open(d,{legacy:{claude:{previous:d1Envelope(),lastEventAt:D1_NOW}}})
  expect(successValue(next.read('claude')).state.previous).toEqual(d1Envelope())
  expect(JSON.parse(readFileSync(join(d,'collector-ledger.marker.json'),'utf8'))).toEqual({status:'active'})
 })
 it('When the initialized provider rows are empty Then refuses to rebuild a seemingly valid active DB',()=>{
  const d=dir(),l=open(d);l.close()
  const db=new DatabaseSync(join(d,'collector-ledger.sqlite'));db.exec('DELETE FROM provider_state');db.close()
  expect(openSqliteLedger({directory:d,nowMs:now})).toMatchObject({ok:false,reason:'ledger_start_failed'})
 })
 it('When a provider was added after the ledger was created Then inserts only its missing row and keeps existing state',()=>{
  const d=dir(),l=open(d);successValue(add(l));l.close()
  const db=new DatabaseSync(join(d,'collector-ledger.sqlite'));db.exec("DELETE FROM provider_state WHERE provider='zai'");db.close()
  const next=open(d)
  expect(successValue(next.read('claude')).rows).toHaveLength(1)
  expect(successValue(next.read('zai')).rows).toHaveLength(0)
  next.close()
  const check=new DatabaseSync(join(d,'collector-ledger.sqlite'));expect(check.prepare('SELECT count(*) AS n FROM provider_state').get()).toEqual({n:7});check.close()
 })
 it('When the ledger has an unknown provider row Then refuses to start',()=>{
  const d=dir(),l=open(d);l.close()
  const db=new DatabaseSync(join(d,'collector-ledger.sqlite'));db.exec("UPDATE provider_state SET provider='legacy-x' WHERE provider='zai'");db.close()
  expect(openSqliteLedger({directory:d,nowMs:now})).toMatchObject({ok:false,reason:'ledger_start_failed'})
 })
 it('When queued data exceeds seven days Then quarantines it and never returns it for automatic sending',()=>{
  const l=open(dir());successValue(add(l))
  expect(successValue(l.pending(now+7*86400000))).toHaveLength(1)
  expect(successValue(l.quarantine(now+7*86400000+1))).toBe(1)
  expect(successValue(l.pending(now+7*86400000+1))).toEqual([])
  expect(successValue(l.read('claude')).rows[0].quarantined).toBe(true)
 })
 it('When a seven-day row is quarantined Then stats excludes it and new collection continues',()=>{
  const l=open(dir());successValue(add(l))
  expect(successValue(l.quarantine(now+7*86400000+1))).toBe(1)
  expect(successValue(l.stats())).toEqual({count:0,bytes:0,oldestMs:null})
  expect(successValue(l.stats()).count).toBe(0)
  expect(add(l,2)).toMatchObject({ok:true})
  expect(successValue(l.stats()).count).toBe(1)
 })
 it('When an existing operation is assigned another seq Then rejects without altering accepted bytes',()=>{
  const l=open(dir());successValue(add(l));const before=successValue(l.read('claude'))
  const changed=successValue(createCollectorD1Write({...before.rows[0].operation,writeSeq:2}))
  expect(l.update('claude',data=>({ok:true,value:{...data,rows:[{...data.rows[0],operation:changed}]}}))).toMatchObject({ok:false,reason:'sequence_conflict'})
  expect(successValue(l.read('claude'))).toEqual(before)
 })
 it('When an update changes identity or reuses a seq Then rejects the whole transaction',()=>{
  const l=open(dir());successValue(add(l));const before=successValue(l.read('claude'))
  expect(l.update('claude',data=>({ok:true,value:{...data,rows:[...data.rows,data.rows[0]]}})).ok).toBe(false)
  expect(successValue(l.read('claude'))).toEqual(before)
 })
})
