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
/** Runtime and Wrangler profile settings only. DB, Discord, API credentials, account ids, and endpoint overrides are never inherited.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv} */
function wranglerChildEnv(env=process.env){
 /** @type {NodeJS.ProcessEnv} */const child={}
 for(const key of ['HOME','PATH','XDG_CONFIG_HOME','XDG_CACHE_HOME','TMPDIR','TMP','TEMP','APPDATA','LOCALAPPDATA','SYSTEMROOT','LANG','LC_ALL','LC_CTYPE','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NO_PROXY','https_proxy','http_proxy','all_proxy','no_proxy','NODE_EXTRA_CA_CERTS','NODE_USE_ENV_PROXY','SSL_CERT_FILE','SSL_CERT_DIR','CLOUDFLARE_AUTH_PROFILE','CLOUDFLARE_AUTH_USE_KEYRING'])if(env[key]!==undefined)child[key]=env[key]
 Object.assign(child,{CI:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',WRANGLER_API_ENVIRONMENT:'production'})
 return child
}
/** Captured output is never logged. OAuth refresh remains Wrangler's responsibility.
 * @param {readonly string[]} args
 * @param {{env?:NodeJS.ProcessEnv,execute?:(request:{file:string,args:string[],cwd:string,env:NodeJS.ProcessEnv})=>Promise<{exitCode:number,stdout:string}>}} [options]
 * @returns {Promise<{exitCode:number,stdout:string}>} */
export function executeWrangler(args,options={}){
 const env=wranglerChildEnv(options.env??process.env)
 const run=options.execute??(/** @param {{file:string,args:string[],cwd:string,env:NodeJS.ProcessEnv}} request */request=>new Promise(resolve=>execFile(request.file,request.args,{cwd:request.cwd,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:request.env},(error,stdout)=>resolve({exitCode:error?1:0,stdout:error?'':stdout}))))
 return run({file:process.execPath,args:[fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),...args],cwd:fileURLToPath(new URL('../../../',import.meta.url)),env})
}
/** Operator-only transport. No automatic retries, remote credentials, or collector runtime wiring.
 * @param {{directory:string,database:string,env?:NodeJS.ProcessEnv,execute?:(args:readonly string[])=>Promise<{exitCode:number,stdout:string}>,remote?:boolean,persistTo?:string,configPath?:string,wait?:(ms:number)=>Promise<void>,now?:()=>number}} options
 * @returns {import('../../domain/usage/d1-sender-types.ts').D1QueryPort} */
export function createWranglerD1Query(options){
 const execute=options.execute??(args=>executeWrangler(args,{env:options.env})),now=options.now??Date.now,wait=options.wait??(ms=>new Promise(r=>setTimeout(r,ms)))
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
