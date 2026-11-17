import{describe,it,expect}from'vitest'
// @ts-expect-error operator script is plain ESM
import{runCollectorApply,applyMain}from'../../scripts/collector-apply.mjs'
const root='/synthetic/release',config={apps:[{name:'zzik-usage-collector',env:{ZZIK_STORE:'d1',ZZIK_PROVIDERS:'claude,codex',ZZIK_INTERVAL_SEC:'900',ZZIK_INTERVAL_SEC_CODEX:'180'}}]}
const status={ok:true,providers:{claude:{ageSec:1,intervalSec:900,fresh:true},codex:{ageSec:1,intervalSec:180,fresh:true}},export:{status:'ok',at:'2026-11-17T00:00:00.000Z'}}
function fixture(){
 const calls:any[]=[]
 const runtime={name:'zzik-usage-collector',pm2_env:{status:'online',pm_cwd:root,...config.apps[0].env}}
 const execute=async(command:string,args:readonly string[],options:any)=>{calls.push({command,args,options});return{exitCode:0,stderr:'private email@example.invalid',stdout:command==='pm2'&&args[0]==='jlist'?JSON.stringify([runtime]):command==='pm2'?'secret token':JSON.stringify(status)}}
 return{releaseDir:root,config,clock:{now:()=>123456},execute,calls,runtime}
}
describe('Given a deterministic collector apply workflow',()=>{
 it('When no apply flag is provided Then performs zero external commands',async()=>{
  const f=fixture();expect(await runCollectorApply(f)).toEqual({ok:true,dryRun:true});expect(f.calls).toHaveLength(0)
 })
 it('When applied Then restarts, saves, validates and waits exactly in order',async()=>{
  const f=fixture();expect(await runCollectorApply({...f,apply:true,maxWaitMs:12345})).toEqual({ok:true,dryRun:false,status})
  expect(f.calls.map(c=>[c.command,c.args[0]])).toEqual([['pm2','restart'],['pm2','save'],['pm2','jlist'],[process.execPath,expect.any(String)]])
  expect(f.calls[0].args).toEqual(['restart','collector/ecosystem.config.cjs','--only','zzik-usage-collector','--update-env'])
  expect(f.calls.every(c=>c.options.cwd===root)).toBe(true)
  expect(f.calls[3].args).toEqual([root+'/scripts/d1-status.mjs','--wait-fresh','--since','123456','--max-wait-ms','12345'])
 })
 it('When restart or save fails Then never runs later steps or leaks the command result',async()=>{
  for(const stage of ['restart','save']){
   const f=fixture(),execute=async(c:string,a:readonly string[],o:any)=>a[0]===stage?{exitCode:1,stdout:'secret',stderr:'token'}:f.execute(c,a,o)
   const r=await runCollectorApply({...f,apply:true,execute});expect(r).toEqual({ok:false,dryRun:false,stage});expect(JSON.stringify(r)).not.toMatch(/secret|token/)
   expect(f.calls.some(c=>c.args[0]==='jlist')).toBe(false)
  }
 })
 it('When PM2 status, cwd, store, provider set, interval or DB_URL differ Then refuses freshness check',async()=>{
  const changes=[{status:'stopped'},{pm_cwd:'/wrong'},{ZZIK_STORE:'postgres'},{ZZIK_PROVIDERS:'claude'},{ZZIK_INTERVAL_SEC_CODEX:'900'},{DB_URL:'secret'},{env:{DB_URL:'secret'}},{env:{ZZIK_STORE:'postgres'}},{env:{ZZIK_INTERVAL_SEC_CODEX:'900'}}]
  for(const change of changes){const f=fixture();Object.assign(f.runtime.pm2_env,change);const r=await runCollectorApply({...f,apply:true});expect(r).toEqual({ok:false,dryRun:false,stage:'runtime'});expect(f.calls).toHaveLength(3)}
 })
 it('When jlist is corrupt or contains duplicate collector instances Then fails closed',async()=>{
  for(const stdout of ['not json',JSON.stringify([]),JSON.stringify([fixture().runtime,fixture().runtime])]){
   const f=fixture(),execute=async(c:string,a:readonly string[],o:any)=>a[0]==='jlist'?{exitCode:0,stdout,stderr:''}:f.execute(c,a,o)
   expect(await runCollectorApply({...f,apply:true,execute})).toMatchObject({ok:false,stage:'runtime'})
  }
 })
 it('When freshness fails or returns unsafe JSON Then returns only a sanitized failure',async()=>{
  for(const stdout of [JSON.stringify({...status,ok:false}),JSON.stringify({...status,privateToken:'secret'}),'secret']){
   const f=fixture(),execute=async(c:string,a:readonly string[],o:any)=>c===process.execPath?{exitCode:1,stdout,stderr:'private'}:f.execute(c,a,o)
   const r=await runCollectorApply({...f,apply:true,execute});expect(r).toEqual({ok:false,dryRun:false,stage:'fresh'});expect(JSON.stringify(r)).not.toMatch(/secret|private/)
  }
 })
 it('When a nominally successful child sends extra fields or mismatched intervals Then rejects its JSON',async()=>{
  for(const value of [{...status,privateToken:'secret'},{...status,providers:{...status.providers,codex:{ageSec:1,intervalSec:900,fresh:true}}},{...status,export:{status:'ok',at:'private'}}]){
   const f=fixture(),execute=async(c:string,a:readonly string[],o:any)=>c===process.execPath?{exitCode:0,stdout:JSON.stringify(value),stderr:''}:f.execute(c,a,o)
   expect(await runCollectorApply({...f,apply:true,execute})).toEqual({ok:false,dryRun:false,stage:'fresh'})
  }
 })
 it('When a port throws Then sanitizes failure and CLI still writes just one final JSON',async()=>{
  const f=fixture(),lines:string[]=[];await applyMain(['--apply'],{...f,execute:async()=>{throw Error('secret')},write:(s:string)=>lines.push(s)})
  expect(lines).toHaveLength(1);expect(JSON.parse(lines[0])).toEqual({ok:false,dryRun:false,stage:'restart'})
 })
 it('When flags are invalid Then performs no mutation',async()=>{
  for(const args of [['--unknown'],['--max-wait-ms','bad'],['--apply','--dry-run']]){const f=fixture(),lines:string[]=[];expect(await applyMain(args,{...f,write:(s:string)=>lines.push(s)})).toBe(64);expect(f.calls).toHaveLength(0);expect(lines).toHaveLength(1)}
 })
})
