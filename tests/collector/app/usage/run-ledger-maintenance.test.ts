import {describe,it,expect} from 'vitest'
import {runLedgerMaintenance} from '../../../../collector/app/usage/run-ledger-maintenance.mjs'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
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
 it('When successful maintenance returns its persisted timestamp Then stores that exact value instead of the earlier tick clock',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-b3-prune-time-'));let now=Date.parse(D1_NOW)
  const ledger=successValue(openSqliteLedger({directory,nowMs:now,lastPruneAt:'2026-11-14T00:00:00Z'}))
  try{
   await runLedgerMaintenance({ledger,clock:{now:()=>now},retentionDays:30,notice:{notify:async()=>{}},maintenance:{checkHealth:async()=>({ok:true}),prune:async()=>{now+=5000;return {ok:true,lastPruneAt:new Date(now).toISOString()}}}})
   expect(successValue(ledger.pruneState()).lastPruneAt).toBe(new Date(now).toISOString())
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })

})
