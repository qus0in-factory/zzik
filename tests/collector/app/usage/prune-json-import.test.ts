import {describe,it,expect} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readLegacyLedgerInputs} from '../../../../collector/app/usage/d1-startup.mjs'
import {createStateFile} from '../../../../collector/infra/usage/state-file.mjs'
import {openSqliteLedger} from '../../../../collector/infra/usage/sqlite-ledger.mjs'
import {createFakeCollectorPorts} from '../../../fakes/collector-ports'
import {successValue,D1_NOW} from '../../../fakes/d1-contract'
describe('Given separate provider state and usage-prune.json files',()=>{
 it('When the startup input is imported Then usage-prune.json lastPruneAt wins and survives ledger reopen',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-prune-import-'))
  try{
   const path=join(directory,'usage-prune.json');writeFileSync(path,JSON.stringify({lastPruneAt:D1_NOW}),{mode:0o600})
   const provider=createFakeCollectorPorts({lastPruneAt:'2020-01-01T00:00:00Z'})
   const input=await readLegacyLedgerInputs([{id:'claude',ports:provider}],createStateFile({path}))
   expect(input.lastPruneAt).toBe(D1_NOW)
   const ledger=successValue(openSqliteLedger({directory,nowMs:Date.parse(D1_NOW),...input}));expect(successValue(ledger.pruneState())).toEqual({lastPruneAt:D1_NOW,skipFirstPrune:false});ledger.close()
   const reopened=successValue(openSqliteLedger({directory,nowMs:Date.parse(D1_NOW)}));try{expect(successValue(reopened.pruneState()).lastPruneAt).toBe(D1_NOW)}finally{reopened.close()}
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
})
