import {describe,it,expect} from 'vitest'
import {runLedgerMaintenance} from '../../../../collector/app/usage/run-ledger-maintenance.mjs'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {DatabaseSync} from 'node:sqlite'
import {successValue,D1_NOW} from '../../../fakes/d1-contract'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
describe('Given unknown prune history and durable skip state',()=>{
 it('When cycles repeat Then skips first cycle, waits 24h and records only a completed prune',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-b3-prune-'));let now=Date.parse(D1_NOW),calls=0,fail=true
  const ledger=successValue(openSqliteLedger({directory,nowMs:now}))
  const maintenance={checkHealth:async()=>({ok:true}),prune:async()=>{calls++;return fail?{ok:false}:{ok:true,lastPruneAt:new Date(now).toISOString()}}}
  try{
   const run=()=>runLedgerMaintenance({ledger,maintenance,clock:{now:()=>now},retentionDays:30,notice:{notify:async()=>{}}})
   await run();await run();expect(calls).toBe(0);now+=86400000;await run();expect(calls).toBe(1);expect(successValue(ledger.pruneState()).lastPruneAt).toBeNull();fail=false;await run();expect(successValue(ledger.pruneState()).lastPruneAt).toBe(new Date(now).toISOString())
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })
 it('When an existing ledger prune checkpoint is broken Then reports once, waits 24h and then prunes once',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-b3-prune-broken-'));let now=Date.parse(D1_NOW),calls=0;const notices:unknown[]=[]
  const first=successValue(openSqliteLedger({directory,nowMs:now}));first.close()
  const db=new DatabaseSync(join(directory,'collector-ledger.sqlite'));db.exec("UPDATE ledger_meta SET value='{\"lastPruneAt\":\"broken\",\"skipFirstPrune\":false}' WHERE key='prune'");db.close()
  const ledger=successValue(openSqliteLedger({directory,nowMs:now}))
  const maintenance={checkHealth:async()=>({ok:true}),prune:async()=>{calls+=1;return {ok:true,lastPruneAt:new Date(now).toISOString()}}}
  const run=()=>runLedgerMaintenance({ledger,maintenance,clock:{now:()=>now},retentionDays:30,notice:{notify:async event=>{notices.push(event)}}})
  try{
   await run();await run();expect(calls).toBe(0);expect(notices).toEqual([{reason:'prune_time_unknown'}]);expect(successValue(ledger.pruneState()).skippedAtMs).toBe(now)
   now+=1000;await run();expect(calls).toBe(0);expect(notices).toHaveLength(1)
   now+=86400000;await run();expect(calls).toBe(1);expect(successValue(ledger.pruneState()).lastPruneAt).toBe(new Date(now).toISOString())
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })
 it('When successful maintenance returns its persisted timestamp Then stores that exact value instead of the earlier tick clock',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-b3-prune-time-'));let now=Date.parse(D1_NOW)
  const ledger=successValue(openSqliteLedger({directory,nowMs:now,lastPruneAt:'2026-11-14T00:00:00Z'}))
  try{
   await runLedgerMaintenance({ledger,clock:{now:()=>now},retentionDays:30,notice:{notify:async()=>{}},maintenance:{checkHealth:async()=>({ok:true}),prune:async()=>{now+=5000;return {ok:true,lastPruneAt:new Date(now).toISOString()}}}})
   expect(successValue(ledger.pruneState()).lastPruneAt).toBe(new Date(now).toISOString())
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })

})
