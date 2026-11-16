import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from 'node:fs'
import {join} from 'node:path'
/** Render only positional parameters; quoted SQL tokens/comments are never substituted.
 * @param {import('../../../shared/d1-contract.ts').D1SqlStatement} statement
 * @returns {import('../../../shared/d1-contract.ts').D1Result<string>} */
export function renderWranglerSql(statement){
 try{
  let index=0,sql='',quote='',comment=''
  for(let i=0;i<statement.sql.length;i++){
   const c=statement.sql[i],next=statement.sql[i+1]
   if(comment){sql+=c;if(comment==='line'&&c==='\n')comment='';else if(comment==='block'&&c==='*'&&next==='/'){sql+=next;i++;comment=''};continue}
   if(quote){sql+=c;if(c===quote){if(next===quote){sql+=next;i++}else quote=''};continue}
   if(c==='-'&&next==='-'){comment='line';sql+=c+next;i++;continue}
   if(c==='/'&&next==='*'){comment='block';sql+=c+next;i++;continue}
   if(c==="'"||c==='"'||c==='`'){quote=c;sql+=c;continue}
   if(c!=='?'){sql+=c;continue}
   if(index>=statement.params.length)throw Error('missing_parameter')
   const p=statement.params[index++]
   if(p===null)sql+='NULL'
   else if(typeof p==='string'&&!p.includes('\0'))sql+="'"+p.replaceAll("'","''")+"'"
   else if(typeof p==='number'&&Number.isSafeInteger(p))sql+=String(p)
   else throw Error('invalid_parameter')
  }
  if(quote||comment==='block'||index!==statement.params.length)return {ok:false,reason:'invalid_sql_parameters'}
  if(Buffer.byteLength(sql,'utf8')>100000)return {ok:false,reason:'sql_statement_too_large'}
  return {ok:true,value:sql}
 }catch{return {ok:false,reason:'invalid_sql_parameters'}}
}
/** Captured output is never logged. OAuth refresh remains Wrangler's responsibility.
 * @param {readonly string[]} args @returns {Promise<{exitCode:number,stdout:string}>} */
export function executeWrangler(args){
 const env={...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1'}
 for(const key of ['DB_URL','ZZIK_D1_API_TOKEN','ZZIK_D1_ACCOUNT_ID','ZZIK_D1_DATABASE_ID','CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_API_KEY','CF_API_KEY','CLOUDFLARE_EMAIL','CF_EMAIL','CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID'])delete /** @type {Record<string,string|undefined>} */(env)[key]
 return new Promise(resolve=>execFile(process.execPath,[fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),...args],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env},(error,stdout)=>resolve({exitCode:error?1:0,stdout:error?'':stdout})))
}
/** Operator-only transport. No automatic retries, remote credentials, or collector runtime wiring.
 * @param {{directory:string,database:string,execute?:(args:readonly string[])=>Promise<{exitCode:number,stdout:string}>,remote?:boolean,persistTo?:string,configPath?:string,wait?:(ms:number)=>Promise<void>,now?:()=>number}} options
 * @returns {import('../../domain/usage/d1-sender-types.ts').D1QueryPort} */
export function createWranglerD1Query(options){
 const execute=options.execute??executeWrangler,now=options.now??Date.now,wait=options.wait??(ms=>new Promise(r=>setTimeout(r,ms)))
 let next=0,tail=Promise.resolve()
 /** @param {readonly import('../../../shared/d1-contract.ts').D1SqlStatement[]} statements @returns {Promise<import('../../domain/usage/d1-sender-types.ts').D1QueryResult>} */
 const send=async statements=>{
  /** @type {string|undefined} */let own
  try{
   if(!/^[a-zA-Z0-9_-]+$/.test(options.database)||statements.length<1||statements.length>21)throw Error('invalid_request')
   const sql=[]
   for(const s of statements){const rendered=renderWranglerSql(s);if(!rendered.ok)throw Error('invalid_sql');sql.push(rendered.value)}
   const text=sql.map(s=>s.replace(/;\s*$/,'')+';').join('\n')
   if(Buffer.byteLength(text,'utf8')>512*1024)throw Error('chunk_too_large')
   const args=['d1','execute',options.database,options.remote===false?'--local':'--remote','--json','--yes']
   if(options.configPath)args.push('--config',options.configPath)
   if(options.persistTo)args.push('--persist-to',options.persistTo)
   if(statements.every(s=>/^\s*SELECT\b/i.test(s.sql)))args.push('--command',text)
   else{own=mkdtempSync(join(options.directory,'wrangler-chunk-'));chmodSync(own,0o700);const file=join(own,'chunk.sql');writeFileSync(file,text,{mode:0o600});args.push('--file',file)}
   await wait(Math.max(0,next-now()));next=now()+1000
   const result=await execute(args)
   if(result.exitCode!==0)throw Error('wrangler_failed')
   // Remote file imports may prepend progress lines even with --json.
   // Accept only a complete trailing JSON array; never log discarded text.
   const candidates=[0,...Array.from(result.stdout.matchAll(/^\s*\[\s*\{/gm),m=>m.index)]
   let rows
   for(const start of candidates){try{rows=JSON.parse(result.stdout.slice(start));break}catch{}}

   if(!Array.isArray(rows)||!rows.length||rows.some(r=>r===null||r.success!==true||!Array.isArray(r.results)))throw Error('invalid_response')
   return {ok:true,value:rows}
  }catch{return {ok:false,reason:'invalid',status:null,retryAfterMs:0}}
  finally{if(own)rmSync(own,{recursive:true,force:true})}
 }
 return {authStopped:()=>false,query(statements){const result=tail.then(()=>send(statements));tail=result.then(()=>{},()=>{});return result}}
}
