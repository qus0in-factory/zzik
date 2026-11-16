#!/usr/bin/env node
/** Explicit operator tool. No automatic .env load; never prints source rows or credentials. */
import postgres from 'postgres'
import {createInterface} from 'node:readline/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createBackfillSpool} from '../collector/infra/usage/backfill-spool.mjs'
import {createPgBackfillSource} from '../collector/infra/usage/pg-backfill-source.mjs'
import {createD1BackfillDestination} from '../collector/infra/usage/d1-backfill-destination.mjs'
import {createWranglerD1Query,renderWranglerSql} from '../collector/infra/usage/wrangler-d1-query.mjs'
import {prepareBackfillRow,backfillStatement} from '../collector/domain/usage/d1-backfill.mjs'
import {createD1RestClient} from '../collector/infra/usage/d1-rest-client.mjs'
import {createD1ControlFile} from '../collector/infra/usage/d1-control-file.mjs'
import {lockBackfillLedger,createBackfillCheckpoint} from '../collector/infra/usage/backfill-local-state.mjs'
import {runBackfill} from '../collector/app/usage/d1-backfill.mjs'
const print=/** @param {unknown} value */value=>process.stdout.write(JSON.stringify(value)+'\n')
/** @param {{directory:string,checkpointPath:string|null,env:Record<string,string|undefined>,transport?:string,database?:string}} options
 * @returns {Promise<import('../shared/d1-contract.ts').D1Result<import('../collector/domain/usage/d1-backfill-types.ts').BackfillCommandPorts>>} */
async function createLivePorts({directory,checkpointPath,env,transport='rest',database='zzik-usage'}){
 const locked=lockBackfillLedger(directory);if(!locked.ok)return locked
 if(locked.value.outboxCount!==0){locked.value.close();return {ok:false,reason:'ledger_outbox_not_empty'}}
 /** @type {ReturnType<typeof postgres>|undefined} */let client
 /** @type {import('../collector/domain/usage/d1-backfill-types.ts').BackfillSpool|undefined} */let ownSpool
 try{
  client=postgres(/** @type {string} */(env.DB_URL),{max:1,idle_timeout:5,connect_timeout:10,prepare:false,onnotice:()=>{}})
  const connection=client
  const openedSpool=createBackfillSpool({directory});if(!openedSpool.ok){await connection.end({timeout:1});locked.value.close();return openedSpool}
  const spool=openedSpool.value;ownSpool=spool
  const reader=createPgBackfillSource({query:async(sql,params)=>({rows:await connection.unsafe(sql,/** @type {any} */(params??[]))})})
  /** @type {Promise<import('../shared/d1-contract.ts').D1Result<import('../collector/domain/usage/d1-backfill-types.ts').BackfillInput>>|null} */let prepared=null
  const query=transport==='wrangler'?createWranglerD1Query({directory,database}):createD1RestClient({mode:'d1',dryRun:false,control:createD1ControlFile({path:join(directory,'backfill-rest-control.json')}),accountId:/** @type {string} */(env.ZZIK_D1_ACCOUNT_ID),databaseId:/** @type {string} */(env.ZZIK_D1_DATABASE_ID),token:/** @type {string} */(env.ZZIK_D1_API_TOKEN),clock:{now:()=>Date.now()},wait:ms=>new Promise(r=>setTimeout(r,ms)),fetch:globalThis.fetch})
  return {ok:true,value:{
   source:{read(){prepared??=(async()=>{
    let envelopeBytes=0,maxStatementBytes=0
    const read=await reader.scan((kind,rows)=>{
     for(const row of rows){
      const item=prepareBackfillRow(row,kind);if(!item.ok)return item
      envelopeBytes+=Buffer.byteLength(item.value.row.envelopeJson,'utf8')
      if(transport==='wrangler'){
       const stmt=backfillStatement(item.value);if(!stmt.ok)return stmt
       const rendered=renderWranglerSql(stmt.value);if(!rendered.ok)return rendered
       maxStatementBytes=Math.max(maxStatementBytes,Buffer.byteLength(rendered.value,'utf8'))
      }
     }
     return spool.append(kind,rows)
    })
    if(!read.ok)return read
    const plan=spool.seal();if(plan.ok)print({sourceEnvelopeBytes:envelopeBytes,maxStatementBytes})
    return plan
   })();return prepared}},
   destination:createD1BackfillDestination(query),checkpoint:createBackfillCheckpoint(checkpointPath??join(directory,'d1-backfill-checkpoint.json')),ledgerOutboxCount:locked.value.outboxCount,
   close:async()=>{try{spool.close()}finally{try{await connection.end({timeout:1})}finally{locked.value.close()}}},
  }}
 }catch{ownSpool?.close();await client?.end({timeout:1});locked.value.close();return {ok:false,reason:'backfill_setup_failed'}}
}
/** Dependency injection is a module API for local tests; the command has no fake-port flag/env hook.
 * @param {{args?:string[],env?:Record<string,string|undefined>,createPorts?:typeof createLivePorts}} [options] */
export async function runBackfillCli({args=process.argv.slice(2),env=process.env,createPorts=createLivePorts}={}){
 if(args.length===1&&args[0]==='--help'){process.stdout.write('node --env-file=<private-env> scripts/d1-backfill.mjs --state-dir <directory> [--checkpoint <path>] [--transport rest|wrangler] [--database <name>] [--apply]\nDefault: read-only dry-run; --apply also requires typed APPLY <planSha256> confirmation.\n');return}
 let apply=false,directory=null,checkpointPath=null,transport='rest',database='zzik-usage'
 for(let i=0;i<args.length;i++){if(args[i]==='--apply')apply=true;else if(args[i]==='--state-dir'&&args[i+1]&&!args[i+1].startsWith('--'))directory=resolve(args[++i]);else if(args[i]==='--checkpoint'&&args[i+1]&&!args[i+1].startsWith('--'))checkpointPath=resolve(args[++i]);else if(args[i]==='--transport'&&['rest','wrangler'].includes(args[i+1]))transport=args[++i];else if(args[i]==='--database'&&/^[a-zA-Z0-9_-]+$/.test(args[i+1]??''))database=args[++i];else{print({ok:false,reason:'invalid_arguments'});process.exitCode=64;return}}
 if(directory===null){print({ok:false,reason:'state_directory_required'});process.exitCode=64;return}
 if(!(transport==='wrangler'?[env.DB_URL]:[env.DB_URL,env.ZZIK_D1_API_TOKEN,env.ZZIK_D1_ACCOUNT_ID,env.ZZIK_D1_DATABASE_ID]).every(value=>typeof value==='string'&&value.trim())){print({ok:false,reason:'missing_configuration'});process.exitCode=78;return}
 const opened=await createPorts({directory,checkpointPath,env,transport,database});if(!opened.ok){print(opened);process.exitCode=78;return}
 const ports=opened.value
 try{
  const source=await ports.source.read();if(!source.ok){print(source);process.exitCode=1;return}
  const options={source:source.value,destination:ports.destination,checkpoint:ports.checkpoint,ledgerOutboxCount:ports.ledgerOutboxCount}
  const preview=await runBackfill(options);print(preview)
  if(!preview.ok){process.exitCode=1;return}
  if(!apply)return
  const previewValue=/** @type {{planSha256:string}} */(preview.value)
  const confirmation=await readConfirmation({planSha256:previewValue.planSha256})
  const result=await runBackfill({...options,apply:true,confirmation});print(result);if(!result.ok)process.exitCode=1
 }finally{await ports.close()}
}
/** @param {{input?:import('node:stream').Readable,output?:import('node:stream').Writable,planSha256:string}} options */
export async function readConfirmation({input=process.stdin,output=process.stderr,planSha256}){
 const rl=createInterface({input,output}),controller=new AbortController()
 const onClose=()=>controller.abort()
 rl.once('close',onClose)
 if(input.readableEnded)controller.abort()
 try{return await rl.question(`Confirm D1 writers are stopped and this source plan is approved; type APPLY ${planSha256}: `,{signal:controller.signal})}finally{rl.off('close',onClose);rl.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await runBackfillCli()}catch{print({ok:false,reason:'backfill_tool_failed'});process.exitCode=1}
}
