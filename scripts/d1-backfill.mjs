#!/usr/bin/env node
/** Explicit operator tool. No automatic .env load; never prints source rows or credentials. */
import postgres from 'postgres'
import {createInterface} from 'node:readline/promises'
import {join,resolve} from 'node:path'
import {createPgBackfillSource} from '../collector/infra/usage/pg-backfill-source.mjs'
import {createD1BackfillDestination} from '../collector/infra/usage/d1-backfill-destination.mjs'
import {createD1RestClient} from '../collector/infra/usage/d1-rest-client.mjs'
import {createD1ControlFile} from '../collector/infra/usage/d1-control-file.mjs'
import {lockBackfillLedger,createBackfillCheckpoint} from '../collector/infra/usage/backfill-local-state.mjs'
import {runBackfill} from '../collector/app/usage/d1-backfill.mjs'
const print=value=>process.stdout.write(JSON.stringify(value)+'\n')
async function main(){
 const args=process.argv.slice(2)
 if(args.length===1&&args[0]==='--help'){process.stdout.write('node --env-file=<private-env> scripts/d1-backfill.mjs --state-dir <directory> [--checkpoint <path>] [--apply]\nDefault: read-only dry-run; --apply also requires typed APPLY <planSha256> confirmation.\n');return}
 let apply=false,directory=null,checkpointPath=null
 for(let i=0;i<args.length;i++){if(args[i]==='--apply')apply=true;else if(args[i]==='--state-dir'&&args[i+1]&&!args[i+1].startsWith('--'))directory=resolve(args[++i]);else if(args[i]==='--checkpoint'&&args[i+1]&&!args[i+1].startsWith('--'))checkpointPath=resolve(args[++i]);else{print({ok:false,reason:'invalid_arguments'});process.exitCode=64;return}}
 if(directory===null){print({ok:false,reason:'state_directory_required'});process.exitCode=64;return}
 const env=process.env
 if(![env.DB_URL,env.ZZIK_D1_API_TOKEN,env.ZZIK_D1_ACCOUNT_ID,env.ZZIK_D1_DATABASE_ID].every(value=>typeof value==='string'&&value.trim())){print({ok:false,reason:'missing_configuration'});process.exitCode=78;return}
 const locked=lockBackfillLedger(directory);if(!locked.ok){print(locked);process.exitCode=78;return}
 const client=postgres(env.DB_URL,{max:1,idle_timeout:5,connect_timeout:10,prepare:false,onnotice:()=>{}})
 try{
  if(locked.value.outboxCount!==0){print({ok:false,reason:'ledger_outbox_not_empty'});process.exitCode=78;return}
  const source=await createPgBackfillSource({query:async(sql,params)=>({rows:await client.unsafe(sql,params)})}).read()
  if(!source.ok){print(source);process.exitCode=1;return}
  const query=createD1RestClient({mode:'d1',dryRun:false,control:createD1ControlFile({path:join(directory,'backfill-rest-control.json')}),accountId:env.ZZIK_D1_ACCOUNT_ID,databaseId:env.ZZIK_D1_DATABASE_ID,token:env.ZZIK_D1_API_TOKEN,clock:{now:()=>Date.now()},wait:ms=>new Promise(r=>setTimeout(r,ms)),fetch:globalThis.fetch})
  const destination=createD1BackfillDestination(query),checkpoint=createBackfillCheckpoint(checkpointPath??join(directory,'d1-backfill-checkpoint.json'))
  const options={source:source.value,destination,checkpoint,ledgerOutboxCount:locked.value.outboxCount}
  const preview=await runBackfill(options);print(preview)
  if(!preview.ok){process.exitCode=1;return}
  if(!apply)return
  const rl=createInterface({input:process.stdin,output:process.stderr})
  let confirmation
  try{confirmation=await rl.question(`Confirm collector is quiesced; type APPLY ${preview.value.planSha256}: `)}finally{rl.close()}
  const result=await runBackfill({...options,apply:true,confirmation});print(result);if(!result.ok)process.exitCode=1
 }finally{await client.end({timeout:1});locked.value.close()}
}
try{await main()}catch{print({ok:false,reason:'backfill_tool_failed'});process.exitCode=1}
