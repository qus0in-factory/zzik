import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {runLedgerMaintenance} from '../../../../collector/app/usage/run-ledger-maintenance.mjs'
import {createD1Maintenance} from '../../../../collector/app/usage/d1-maintenance.mjs'
import {fakeD1Control} from '../../../fakes/d1-control'
import {D1_NOW,successValue} from '../../../fakes/d1-contract'
describe('Given maintenance notices persisted independently of runtime objects',()=>{
 for(const brokenControl of [false,true])it(`When restarted with ${brokenControl?'broken control':'unknown prune time'} Then suppresses the same notice until exactly 24h`,async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-notices-'));let now=Date.parse(D1_NOW),calls=0
  let ledger=successValue(openSqliteLedger({directory,nowMs:now}));const healthy=fakeD1Control(),control=brokenControl?{read:()=>({ok:false as const,reason:'control_corrupt'}),write:healthy.write}:healthy
  const make=()=>createD1Maintenance({mode:'d1',dryRun:false,control,noticeState:{claim:(reason:string,at:number)=>ledger.claimMaintenanceNotice(reason,at)},query:{authStopped:()=>false,query:async()=>{throw Error('no remote query')}},clock:{now:()=>now},notice:{notify:async()=>{calls++}}})
  const run=async()=>{const m=make();if(brokenControl)await m.checkHealth();else await m.prune(null,30)}
  try{
   await run();expect(calls).toBe(1);ledger.close();ledger=successValue(openSqliteLedger({directory,nowMs:now}));now+=86400000-1;await run();expect(calls).toBe(1);now++;await run();expect(calls).toBe(2)
  }finally{ledger.close();rmSync(directory,{recursive:true,force:true})}
 })
 it('When the skip checkpoint fails and the process restarts Then the direct maintenance notice is still throttled durably',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-skip-notice-')),now=Date.parse(D1_NOW);let calls=0
  try{for(let i=0;i<2;i++){
   const ledger=successValue(openSqliteLedger({directory,nowMs:now}))
   try{await runLedgerMaintenance({ledger:{...ledger,checkpointPrune:()=>({ok:false,reason:'injected_checkpoint_failure'})},clock:{now:()=>now},retentionDays:30,maintenance:{checkHealth:async()=>({ok:true}),prune:async()=>({ok:false})},notice:{notify:async()=>{calls++}}})}finally{ledger.close()}
  }expect(calls).toBe(1)}finally{rmSync(directory,{recursive:true,force:true})}
 })

})
