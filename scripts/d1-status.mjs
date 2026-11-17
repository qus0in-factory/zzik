#!/usr/bin/env node
/** Read-only D1 health, one safe final JSON. No provider API, PM2 or account output. */
import {createRequire} from 'node:module'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {tmpdir} from 'node:os'
import {createWranglerD1Query} from '../collector/infra/usage/wrangler-d1-query.mjs'
import {USAGE_PROVIDERS} from '../collector/domain/usage/providers.mjs'
import {executeCommand} from './lib/exec-command.mjs'

export const SCRIPT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const PRIVATE_CHILD_KEYS=['DB_URL','ZZIK_D1_API_TOKEN','ZZIK_D1_ACCOUNT_ID','ZZIK_D1_DATABASE_ID','CLOUDFLARE_API_TOKEN','CF_API_TOKEN','CLOUDFLARE_API_KEY','CF_API_KEY','CLOUDFLARE_EMAIL','CF_EMAIL','CLOUDFLARE_ACCOUNT_ID','CF_ACCOUNT_ID','DISCORD_WEBHOOK_URL','ZZIK_ALERT_WEBHOOK_URL']
const clockDefault={now:()=>Date.now()}
const sleepDefault=ms=>new Promise(r=>setTimeout(r,ms))
/** Read the same default environment PM2 applies; no credentials are evaluated or returned. */
export function collectorSettings(root=SCRIPT_ROOT,config){
 const source=config??createRequire(import.meta.url)(join(root,'collector/ecosystem.config.cjs'))
 const apps=source?.apps?.filter(a=>a.name==='zzik-usage-collector')
 if(apps?.length!==1||apps[0].env?.ZZIK_STORE!=='d1')throw Error('invalid_configuration')
 const env=apps[0].env,providers=String(env.ZZIK_PROVIDERS??'').split(',')
 if(!providers.length||new Set(providers).size!==providers.length||providers.some(p=>!USAGE_PROVIDERS.includes(p)))throw Error('invalid_configuration')
 const intervals=Object.fromEntries(providers.map(p=>[p,Number(env['ZZIK_INTERVAL_SEC_'+p.toUpperCase()]??env.ZZIK_INTERVAL_SEC??900)]))
 if(Object.values(intervals).some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('invalid_configuration')
 return {providers,intervals}
}
export function unavailableStatus(intervals={}){
 return {ok:false,providers:Object.fromEntries(Object.entries(intervals).map(([p,intervalSec])=>[p,{ageSec:null,intervalSec,fresh:false}])),export:{status:'unavailable',at:null}}
}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
function decode(results,settings,now){
 if(results.length!==2||!Array.isArray(results[0]?.results)||!Array.isArray(results[1]?.results)||results[1].results.length>1)throw Error('invalid_metadata')
 const byProvider=new Map()
 for(const row of results[0].results){
  if(!settings.providers.includes(row.provider)||byProvider.has(row.provider)||!Number.isSafeInteger(row.recent_receipts)||row.recent_receipts<0)throw Error('invalid_metadata')
  byProvider.set(row.provider,row)
 }
 const providers=Object.fromEntries(settings.providers.map(p=>{
  const at=byProvider.get(p)?.run_at,intervalSec=settings.intervals[p],valid=Number.isSafeInteger(at)&&at>=0&&at<=now
  return [p,{ageSec:valid?Math.floor((now-at)/1000):null,intervalSec,fresh:valid&&now-at<=(intervalSec*1.5+60)*1000}]
 }))
 const latest=results[1].results[0]
 let exp={status:'missing',at:null}
 if(latest){
  if(![0,1].includes(latest.ok)||!Number.isSafeInteger(latest.ran_at_ms)||latest.ran_at_ms<0||latest.ran_at_ms>now)throw Error('invalid_metadata')
  exp={status:latest.ok===1?'ok':'failed',at:new Date(latest.ran_at_ms).toISOString()}
 }
 return {result:{ok:Object.values(providers).every(p=>p.fresh)&&exp.status==='ok',providers,export:exp},byProvider}
}
/** Inject execute, clock and sleep in tests. The only external statements are SELECTs. */
export async function runD1Status(options={}){
 const root=resolve(options.releaseDir??SCRIPT_ROOT),clock=options.clock??clockDefault,sleep=options.sleep??sleepDefault,execute=options.execute??executeCommand
 let settings,result=unavailableStatus()
 try{
  settings=collectorSettings(root,options.config);result=unavailableStatus(settings.intervals)
  const started=clock.now(),waitFresh=options.waitFresh===true,maxWaitMs=options.maxWaitMs??1200000,pollMs=options.pollMs??5000
  if(!Number.isSafeInteger(started)||!Number.isSafeInteger(maxWaitMs)||maxWaitMs<0||!Number.isSafeInteger(pollMs)||pollMs<=0||waitFresh&&(!Number.isSafeInteger(options.since)||options.since<0))return result
  const deadline=started+maxWaitMs
  const env=Object.fromEntries(PRIVATE_CHILD_KEYS.map(k=>[k,undefined]))
  Object.assign(env,{CLOUDFLARE_AUTH_PROFILE:'zzik-collector',CLOUDFLARE_AUTH_USE_KEYRING:'false',WRANGLER_API_ENVIRONMENT:'production',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false',CI:'true',NO_COLOR:'1'})
  const query=createWranglerD1Query({directory:tmpdir(),database:options.database??'zzik-usage',now:()=>clock.now(),wait:async ms=>{if(ms<=0)return;if(waitFresh&&ms>deadline-clock.now())throw Error('deadline');await sleep(ms)},execute:async args=>{
   const timeoutMs=waitFresh?Math.max(1,Math.min(30000,deadline-clock.now())):30000
   const r=await execute(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,env,timeoutMs})
   return {exitCode:r.exitCode,stdout:r.exitCode===0?r.stdout:''}
  }})
  for(;;){
   const at=clock.now(),response=await query.query([
    {sql:`SELECT s.provider,s.run_at,(SELECT COUNT(*) FROM usage_write_receipt r WHERE r.provider=s.provider AND r.created_at_ms>=?) AS recent_receipts FROM usage_snapshot s WHERE s.provider IN (${settings.providers.map(()=>'?').join(',')})`,params:[at-3600000,...settings.providers]},
    {sql:'SELECT ok,ran_at_ms FROM usage_export_log ORDER BY ran_at_ms DESC,rowid DESC LIMIT 1',params:[]},
   ])
   const finished=clock.now()
   let decoded=null
   if(response.ok){try{decoded=decode(response.value,settings,finished);result=decoded.result}catch{result=unavailableStatus(settings.intervals)}}else result=unavailableStatus(settings.intervals)
   if(!waitFresh)return result
   if(finished<started||finished>deadline)return {...result,ok:false}
   const ready=decoded&&settings.providers.every(p=>{
    const runAt=decoded.byProvider.get(p)?.run_at
    return Number.isSafeInteger(runAt)&&runAt>options.since || result.providers[p].fresh&&finished-options.since>=settings.intervals[p]*1000
   })
   if(ready)return result
   if(finished>=deadline)return {...result,ok:false}
   const delay=Math.min(pollMs,deadline-finished);await sleep(delay)
   if(clock.now()<=finished)return {...result,ok:false}
  }
 }catch{return settings?unavailableStatus(settings.intervals):result}
}
/** Strictly validate a child script's JSON without forwarding arbitrary properties. */
export function validStatus(value,settings){
 if(!object(value)||Object.keys(value).sort().join(',')!=='export,ok,providers'||typeof value.ok!=='boolean'||!object(value.providers)||!object(value.export))return false
 if(Object.keys(value.providers).sort().join(',')!==settings.providers.toSorted().join(','))return false
 if(Object.keys(value.export).sort().join(',')!=='at,status'||!['ok','failed','missing','unavailable'].includes(value.export.status))return false
 if(value.export.at!==null&&(typeof value.export.at!=='string'||!Number.isFinite(Date.parse(value.export.at))||new Date(value.export.at).toISOString()!==value.export.at))return false
 return settings.providers.every(p=>{const s=value.providers[p];return object(s)&&Object.keys(s).sort().join(',')==='ageSec,fresh,intervalSec'&&s.intervalSec===settings.intervals[p]&&typeof s.fresh==='boolean'&&(s.ageSec===null||Number.isSafeInteger(s.ageSec)&&s.ageSec>=0)&&(!s.fresh||s.ageSec!==null)})
}
function parse(args){
 const value={};const seen=new Set()
 for(let i=0;i<args.length;i++){
  const flag=args[i];if(seen.has(flag))throw Error('arguments');seen.add(flag)
  if(flag==='--wait-fresh')value.waitFresh=true
  else if(['--since','--max-wait-ms'].includes(flag)){const raw=args[++i];if(!/^\d+$/.test(raw??''))throw Error('arguments');const n=Number(raw);if(!Number.isSafeInteger(n))throw Error('arguments');value[flag==='--since'?'since':'maxWaitMs']=n}
  else if(flag==='--release'&&args[i+1])value.releaseDir=resolve(args[++i])
  else throw Error('arguments')
 }
 if(value.waitFresh&&value.since===undefined||!value.waitFresh&&value.since!==undefined)throw Error('arguments')
 return value
}
export async function statusMain(args=process.argv.slice(2),ports={}){
 const write=ports.write??(line=>process.stdout.write(line));let result,code
 try{const flags=parse(args);result=await runD1Status({...ports,...flags});code=result.ok?0:1}catch{try{result=unavailableStatus(collectorSettings(ports.releaseDir??SCRIPT_ROOT,ports.config).intervals)}catch{result=unavailableStatus()}code=64}
 write(JSON.stringify(result)+'\n');return code
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await statusMain()
