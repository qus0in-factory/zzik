import {describe,it,expect} from 'vitest'
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {DatabaseSync} from 'node:sqlite'
import {finalizeLedgerRollback} from '../../../../collector/infra/usage/ledger-rollback.mjs'
import {lockBackfillLedger} from '../../../../collector/infra/usage/backfill-local-state.mjs'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {toPgRollbackEvent,toPgRollbackSnapshot} from '../../../../collector/domain/usage/d1-migration.mjs'
import {reverseMigrateToPostgres} from '../../../../worker/infra/usage/pg-rollback'
import {createTestDb} from '../../../fakes/pglite-db'
import {D1_OPERATION_ID,D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
describe('Given a synthetic committed PG reverse migration and a quiesced ledger',()=>{
 it('When only a marker exists without a ledger Then the backfill lock fails closed',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-c-marker-only-'))
  try{
   for(const status of ['active','rolled-back'])writeFileSync(join(directory,'collector-ledger.marker.json'),JSON.stringify({status}))
   expect(lockBackfillLedger(directory)).toEqual({ok:false,reason:'ledger_preflight_failed'})
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
 it('When local cleanup commits Then outbox deletion and rolled-back marker are atomic, JSON is current and a restart imports it',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-c-rollback-')),pg=await createTestDb(),now=Date.parse(D1_NOW)
  const ledger=successValue(openSqliteLedger({directory,nowMs:now}));const accepted=successValue(ledger.update('claude',data=>acceptObservation(data,{operationId:D1_OPERATION_ID,envelope:d1Envelope(),nowMs:now,lastStartedAtMs:now,nextDueMs:now+900000,alerts:[]})));ledger.close()
  const operation=accepted.rows[0].operation,row={id:'9007199254740993',provider:'claude',status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson:operation.envelopeJson}
  const trace:string[]=[]
  try{
   const input={events:[successValue(toPgRollbackEvent(row))],snapshots:[successValue(toPgRollbackSnapshot({...row,id:null},now))]}
   await reverseMigrateToPostgres({query:async<T>(sql:string,p?:readonly unknown[])=>{trace.push(sql);return pg.client.query<T>(sql,p?[...p]:undefined)}},input)
   const commit=trace.indexOf('COMMIT'),setval=trace.findIndex(s=>s.includes('setval('));expect(commit).toBeGreaterThan(-1);expect(setval).toBeGreaterThan(commit)
   const next=await pg.client.query<{id:string}>("INSERT INTO usage_event(provider,status,run_at,envelope) VALUES('codex','ok',now(),'{}') RETURNING CAST(id AS TEXT) AS id");expect(BigInt(next.rows[0].id)).toBeGreaterThan(9007199254740993n)
   await expect(reverseMigrateToPostgres(pg.client,{events:[{...input.events[0],envelope:JSON.stringify(d1Envelope({intervalSec:180}))}],snapshots:[]})).rejects.toThrow('migration hash mismatch')
   const options={directory,pgCommitted:{claude:{previous:d1Envelope(),lastEventAt:D1_NOW}},receipts:{[D1_OPERATION_ID]:{...operation,createdAtMs:now}}}
   const raw=new DatabaseSync(join(directory,'collector-ledger.sqlite'));raw.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON outbox BEGIN SELECT RAISE(ABORT,'synthetic cleanup failure');END");raw.close()
   expect((await finalizeLedgerRollback(options)).ok).toBe(false)
   const check=new DatabaseSync(join(directory,'collector-ledger.sqlite'));expect(check.prepare('SELECT count(*) AS n FROM outbox').get()!.n).toBe(1);expect(check.prepare("SELECT value FROM ledger_meta WHERE key='initialized'").get()!.value).toBe('1');check.exec('DROP TRIGGER fail_cleanup');check.close()
   mkdirSync(join(directory,'usage-state.claude.json'))
   expect(await finalizeLedgerRollback(options)).toMatchObject({ok:false,reason:'rollback_files_pending'})
   rmSync(join(directory,'usage-state.claude.json'),{recursive:true})
   expect((await finalizeLedgerRollback(options)).ok).toBe(true)
   const done=new DatabaseSync(join(directory,'collector-ledger.sqlite'),{readOnly:true});expect(done.prepare('SELECT count(*) AS n FROM outbox').get()!.n).toBe(0);expect(done.prepare("SELECT value FROM ledger_meta WHERE key='initialized'").get()!.value).toBe('rolled-back');done.close()
   const json=JSON.parse(readFileSync(join(directory,'usage-state.claude.json'),'utf8'));expect(json).toMatchObject({previous:d1Envelope(),lastEventAt:D1_NOW,lastRun:{status:'ok',tokenExpiresAt:null}});expect(json).toHaveProperty('gate');expect(json).toHaveProperty('alerts')
   const restored=successValue(openSqliteLedger({directory,nowMs:now+1,legacy:{claude:json}}));try{expect(successValue(restored.read('claude')).state.remoteCommitted).toEqual(d1Envelope())}finally{restored.close()}
  }finally{await pg.close();rmSync(directory,{recursive:true,force:true})}
 })
})
