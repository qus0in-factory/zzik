#!/usr/bin/env node
/** Explicit apply only. All PM2/Wrangler output is captured and never forwarded. */
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {executeCommand} from './lib/exec-command.mjs'
import {SCRIPT_ROOT,PRIVATE_CHILD_KEYS,collectorSettings,validStatus} from './d1-status.mjs'

function matchesRuntime(value,root,settings){
 if(!Array.isArray(value))return false
 const matches=value.filter(p=>p?.name==='zzik-usage-collector')
 if(matches.length!==1)return false
 const e=matches[0].pm2_env
 if(!e||e.status!=='online'||typeof e.pm_cwd!=='string'||resolve(e.pm_cwd)!==root||e.ZZIK_STORE!=='d1'||Object.hasOwn(e,'DB_URL')||e.env&&Object.hasOwn(e.env,'DB_URL'))return false
 const nested=e.env
 if(nested){
  if(typeof nested!=='object'||Array.isArray(nested))return false
  if(Object.hasOwn(nested,'ZZIK_STORE')&&nested.ZZIK_STORE!=='d1')return false
  for(const p of settings.providers){const key='ZZIK_INTERVAL_SEC_'+p.toUpperCase();if(Object.hasOwn(nested,key)&&Number(nested[key])!==settings.intervals[p])return false}
 }
 const providers=String(e.ZZIK_PROVIDERS??'').split(',')
 if(providers.toSorted().join(',')!==settings.providers.toSorted().join(','))return false
 return settings.providers.every(p=>Number(e['ZZIK_INTERVAL_SEC_'+p.toUpperCase()]??e.ZZIK_INTERVAL_SEC??900)===settings.intervals[p])
}
export async function runCollectorApply(options={}){
 const dryRun=options.apply!==true,root=resolve(options.releaseDir??SCRIPT_ROOT),execute=options.execute??executeCommand,clock=options.clock??{now:()=>Date.now()}
 let stage='configuration'
 try{
  const settings=collectorSettings(root,options.config),maxWaitMs=options.maxWaitMs??Math.max(...Object.values(settings.intervals))*1000+60000
  if(!Number.isSafeInteger(maxWaitMs)||maxWaitMs<0)return {ok:false,dryRun,stage:'arguments'}
  if(dryRun)return {ok:true,dryRun:true}
  const since=clock.now();if(!Number.isSafeInteger(since)||since<0)return {ok:false,dryRun:false,stage:'configuration'}
  const env=Object.fromEntries(PRIVATE_CHILD_KEYS.map(k=>[k,undefined])),pmOptions={cwd:root,env,timeoutMs:120000}
  stage='ledger_preflight';const preflight=options.preflight??(async()=>(await execute(process.execPath,[join(root,'scripts/ledger-preflight.mjs')],{cwd:root,env,timeoutMs:60000})).exitCode===0)
  if(!(await preflight()))return {ok:false,dryRun:false,stage}
  stage='restart';if((await execute('pm2',['restart','collector/ecosystem.config.cjs','--only','zzik-usage-collector','--update-env'],pmOptions)).exitCode!==0)return {ok:false,dryRun:false,stage}
  stage='save';if((await execute('pm2',['save'],pmOptions)).exitCode!==0)return {ok:false,dryRun:false,stage}
  stage='runtime';const runtime=await execute('pm2',['jlist'],pmOptions)
  if(runtime.exitCode!==0||!matchesRuntime(JSON.parse(runtime.stdout),root,settings))return {ok:false,dryRun:false,stage}
  stage='fresh';const response=await execute(process.execPath,[join(root,'scripts/d1-status.mjs'),'--wait-fresh','--since',String(since),'--max-wait-ms',String(maxWaitMs)],{cwd:root,env,timeoutMs:maxWaitMs+5000})
  if(response.exitCode!==0)return {ok:false,dryRun:false,stage}
  const status=JSON.parse(response.stdout)
  if(!validStatus(status,settings)||status.ok!==true||status.export.status!=='ok'||settings.providers.some(p=>!status.providers[p].fresh))return {ok:false,dryRun:false,stage}
  return {ok:true,dryRun:false,status}
 }catch{return {ok:false,dryRun,stage}}
}
export async function applyMain(args=process.argv.slice(2),ports={}){
 const write=ports.write??(line=>process.stdout.write(line));let result,code
 try{
  const flags={},seen=new Set()
  for(let i=0;i<args.length;i++){
   const flag=args[i];if(seen.has(flag))throw Error('arguments');seen.add(flag)
   if(flag==='--apply')flags.apply=true
   else if(flag==='--dry-run')flags.dryRun=true
   else if(flag==='--max-wait-ms'){const raw=args[++i];if(!/^\d+$/.test(raw??'')||!Number.isSafeInteger(Number(raw)))throw Error('arguments');flags.maxWaitMs=Number(raw)}
   else if(flag==='--release'&&args[i+1])flags.releaseDir=resolve(args[++i])
   else throw Error('arguments')
  }
  if(flags.apply&&flags.dryRun)throw Error('arguments')
  result=await runCollectorApply({...ports,...flags});code=result.ok?0:1
 }catch{result={ok:false,dryRun:!args.includes('--apply'),stage:'arguments'};code=64}
 write(JSON.stringify(result)+'\n');return code
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)process.exitCode=await applyMain()
