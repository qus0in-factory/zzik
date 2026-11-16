import {describe,it,expect} from 'vitest'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createWranglerD1Query,executeWrangler} from '../../../../collector/infra/usage/wrangler-d1-query.mjs'
import {createD1BackfillDestination} from '../../../../collector/infra/usage/d1-backfill-destination.mjs'
import {runBackfill} from '../../../../collector/app/usage/d1-backfill.mjs'
import {planBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
import type {BackfillCheckpoint,BackfillDestination} from '../../../../collector/domain/usage/d1-backfill-types'
describe('Given actual local Wrangler SQL-file imports and the unchanged backfill use case',()=>{
 it('When importing, failing, resuming and replaying Then preserves large string IDs and canonical hashes without duplicates',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'wrangler-backfill-')),configPath=join(directory,'wrangler.json'),persistTo=join(directory,'state'),schema=join(directory,'schema.sql')
  writeFileSync(configPath,JSON.stringify({name:'local-backfill',compatibility_date:'2026-11-11',d1_databases:[{binding:'DB',database_name:'local-backfill',database_id:'11111111-1111-4111-8111-111111111111'}]}))
  writeFileSync(schema,readFileSync('worker/migrations/0001_d1_storage.sql'))
  try{
   expect((await executeWrangler(['d1','execute','local-backfill','--local','--config',configPath,'--persist-to',persistTo,'--file',schema,'--json','--yes'])).exitCode).toBe(0)
   const q=createWranglerD1Query({directory,database:'local-backfill',remote:false,configPath,persistTo}),destination=createD1BackfillDestination(q)
   const source={events:['9007199254740992','9007199254740993'].map(id=>({id,provider:'claude',status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope({rawText:"quote'; ? -- 안전"}))})),snapshots:[]}
   let saved:BackfillCheckpoint|null=null,calls=0
   const checkpoint={read:()=>({ok:true as const,value:saved}),write:(v:BackfillCheckpoint)=>{saved=v;return {ok:true as const,value:undefined}}}
   const options={source,destination,checkpoint,ledgerOutboxCount:0,apply:true,confirmation:'APPLY '+successValue(planBackfill(source)).summary.planSha256,batchSize:1}
   expect(await runBackfill({...options,apply:false})).toMatchObject({ok:true,value:{written:0}})
   const fail:BackfillDestination={...destination,write:s=>++calls===2?Promise.resolve({ok:false,reason:'injected_failure'}):destination.write(s)}
   expect(await runBackfill({...options,destination:fail})).toMatchObject({ok:false,completed:1})
   expect(await runBackfill(options)).toMatchObject({ok:true,value:{written:1,alreadyPresent:1}})
   expect(await runBackfill(options)).toMatchObject({ok:true,value:{written:0,alreadyPresent:2}})
   expect(successValue(await destination.inspect())).toMatchObject({events:2,receipts:0,dirtyEvents:0,maxId:'9007199254740993',sequence:'9007199254740993'})
   expect(successValue(await destination.read('event',['9007199254740993']))[0].envelopeJson).toContain("quote'; ? -- 안전")
  }finally{rmSync(directory,{recursive:true,force:true})}
 },90000)
})
