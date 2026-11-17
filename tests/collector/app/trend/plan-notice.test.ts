import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'

describe('Given provider failure notice checkpoints',()=>{
 it('When a day passes Then each provider can claim independently at the exact boundary',()=>{
  const dir=mkdtempSync(join(tmpdir(),'zzik-plan-notice-')),now=Date.parse('2026-11-17T15:00:00Z')
  const opened=openSqliteLedger({directory:dir,nowMs:now});if(!opened.ok)throw Error(opened.reason)
  const ledger=opened.value
  try{
   expect(ledger.claimMaintenanceNotice('plan_probe_failed_claude',now)).toEqual({ok:true,value:true})
   expect(ledger.claimMaintenanceNotice('plan_probe_failed_antigravity',now)).toEqual({ok:true,value:true})
   expect(ledger.claimMaintenanceNotice('plan_probe_failed_claude',now+86400000-1)).toEqual({ok:true,value:false})
   expect(ledger.claimMaintenanceNotice('plan_probe_failed_claude',now+86400000)).toEqual({ok:true,value:true})
  }finally{ledger.close();rmSync(dir,{recursive:true,force:true})}
 })
})
