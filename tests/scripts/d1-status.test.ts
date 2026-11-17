import {describe,it,expect} from 'vitest'
// @ts-expect-error operator script is plain ESM
import {runD1Status, statusMain} from '../../scripts/d1-status.mjs'
const config={apps:[{name:'zzik-usage-collector',env:{ZZIK_STORE:'d1',ZZIK_PROVIDERS:'claude,codex',ZZIK_INTERVAL_SEC:'900',ZZIK_INTERVAL_SEC_CODEX:'180'}}]}
const now=2_000_000
function fixture(times:Record<string,number>={claude:now-1000,codex:now-1000}){
 let at=now;const calls:any[]=[]
 const execute=async(command:string,args:readonly string[],options:any)=>{calls.push({command,args,options});return {exitCode:0,stderr:'secret-email@example.invalid',stdout:JSON.stringify([{success:true,results:Object.entries(times).map(([provider,run_at])=>({provider,run_at,recent_receipts:2}))},{success:true,results:[{ok:1,ran_at_ms:now-5000}]}])}}
 return {config,execute,clock:{now:()=>at},sleep:async(ms:number)=>{at+=ms},calls,setNow:(n:number)=>{at=n}}
}
describe('Given deterministic D1 operator status',()=>{
 it('When reading Then uses collector OAuth and emits only the requested safe shape',async()=>{
  const f=fixture();const r=await runD1Status(f)
  expect(r).toEqual({ok:true,providers:{claude:{ageSec:1,intervalSec:900,fresh:true},codex:{ageSec:1,intervalSec:180,fresh:true}},export:{status:'ok',at:new Date(now-5000).toISOString()}})
  expect(f.calls).toHaveLength(1);expect(f.calls[0].options.env.CLOUDFLARE_AUTH_PROFILE).toBe('zzik-collector')
  expect(f.calls[0].args).toContain('--remote');expect(f.calls[0].args).toContain('--command')
  const sql=f.calls[0].args.at(-1);expect(sql).toContain('usage_write_receipt');expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/)
  expect(JSON.stringify(r)).not.toMatch(/email|account|envelope|receipt|secret/)
 })
 it('When age reaches each provider boundary Then includes the last millisecond only',async()=>{
  const f=fixture({claude:now-1_410_000,codex:now-330_000});expect((await runD1Status(f)).ok).toBe(true)
  f.setNow(now+1);const r=await runD1Status(f);expect(r.ok).toBe(false);expect(r.providers.codex.fresh).toBe(false);expect(r.providers.claude.fresh).toBe(false)
 })
 it('When a provider is missing or its timestamp is invalid/future Then fails closed',async()=>{
  expect((await runD1Status(fixture({codex:now}))).providers.claude).toEqual({ageSec:null,intervalSec:900,fresh:false})
  for(const value of [now+1,NaN])expect((await runD1Status(fixture({claude:value,codex:now}))).ok).toBe(false)
 })
 it('When the latest export failed or is absent Then exposes sanitized state and fails',async()=>{
  for(const rows of [[{ok:0,ran_at_ms:now}],[]]){
   const f=fixture();f.execute=async()=>({exitCode:0,stderr:'',stdout:JSON.stringify([{success:true,results:[{provider:'claude',run_at:now,recent_receipts:0},{provider:'codex',run_at:now,recent_receipts:0}]},{success:true,results:rows}])})
   const r=await runD1Status(f);expect(r.ok).toBe(false);expect(r.export.status).toBe(rows.length?'failed':'missing')
  }
 })
 it('When a command throws, fails or returns malformed metadata Then never returns its output',async()=>{
  for(const execute of [async()=>{throw Error('secret token')},async()=>({exitCode:1,stdout:'account private',stderr:'secret'}),async()=>({exitCode:0,stdout:'invalid secret',stderr:''}),async()=>({exitCode:0,stdout:JSON.stringify([{success:true,results:[{provider:'claude',run_at:now,recent_receipts:-1}]},{success:true,results:[]}]),stderr:''})]){
   const r=await runD1Status({...fixture(),execute});expect(r.ok).toBe(false);expect(JSON.stringify(r)).not.toMatch(/secret|token|private|account/)
  }
 })
 it('When every run is newer than since Then returns immediately without waiting a Claude period',async()=>{
  const f=fixture();const r=await runD1Status({...f,waitFresh:true,since:now-2000,maxWaitMs:100});expect(r.ok).toBe(true);expect(f.calls).toHaveLength(1)
 })
 it('When since predates a full provider period and samples remain fresh Then accepts without requiring a new call',async()=>{
  const f=fixture({claude:now-901000,codex:now});const r=await runD1Status({...f,waitFresh:true,since:now-900000,maxWaitMs:1});expect(r.ok).toBe(true)
 })
 it('When run_at equals since Then waits for the period/new sample and respects max wait',async()=>{
  const f=fixture({claude:now,codex:now});const r=await runD1Status({...f,waitFresh:true,since:now,maxWaitMs:10000,pollMs:5000});expect(r.ok).toBe(false);expect(f.calls.length).toBe(3)
 })
 it('When only the fast provider completed its period Then still waits for Claude',async()=>{
  const f=fixture({claude:now-181000,codex:now-1000});const r=await runD1Status({...f,waitFresh:true,since:now-180000,maxWaitMs:0});expect(r.ok).toBe(false)
 })
 it('When the deadline expires during a query Then never reports a late success',async()=>{
  const f=fixture();const execute=async(...args:any[])=>{const r=await (f.execute as any)(...args);f.setNow(now+200);return r}
  expect((await runD1Status({...f,execute,waitFresh:true,since:now-2000,maxWaitMs:100})).ok).toBe(false)
 })
 it('When waiting through CLI Then writes exactly one final JSON and no intermediate messages',async()=>{
  const f=fixture({claude:now,codex:now}),lines:string[]=[]
  await statusMain(['--wait-fresh','--since',String(now),'--max-wait-ms','10000'],{...f,write:(line:string)=>lines.push(line)})
  expect(lines).toHaveLength(1);expect(lines[0].split('\n')).toHaveLength(2);expect(JSON.parse(lines[0]).ok).toBe(false)
 })
 it('When polling observes new collections Then succeeds with one CLI output only',async()=>{
  const times={claude:now,codex:now},f=fixture(times),lines:string[]=[]
  const sleep=async(ms:number)=>{await f.sleep(ms);times.claude=now+1;times.codex=now+1}
  expect(await statusMain(['--wait-fresh','--since',String(now),'--max-wait-ms','10000'],{...f,sleep,write:(s:string)=>lines.push(s)})).toBe(0)
  expect(f.calls).toHaveLength(2);expect(lines).toHaveLength(1);expect(JSON.parse(lines[0]).ok).toBe(true)
 })
 it('When the poll interval is shorter than the query throttle Then the throttle cannot exceed the deadline',async()=>{
  const f=fixture({claude:now,codex:now})
  expect((await runD1Status({...f,waitFresh:true,since:now,maxWaitMs:100,pollMs:100})).ok).toBe(false)
  expect(f.clock.now()).toBe(now+100);expect(f.calls).toHaveLength(1)
 })
 it('When ecosystem intervals change Then computes freshness from the new values',async()=>{
  const f=fixture({claude:now,codex:now-420000})
  f.config.apps[0].env.ZZIK_INTERVAL_SEC_CODEX='240'
  expect((await runD1Status(f)).providers.codex).toEqual({ageSec:420,intervalSec:240,fresh:true})
 })
 it('When arguments are invalid Then prints one safe JSON without executing a command',async()=>{
  for(const args of [['--wait-fresh'],['--since','bad'],['--max-wait-ms','-1'],['--unknown']]){
   const f=fixture(),lines:string[]=[];expect(await statusMain(args,{...f,write:(s:string)=>lines.push(s)})).toBe(64);expect(f.calls).toHaveLength(0);expect(lines).toHaveLength(1);expect(JSON.parse(lines[0]).ok).toBe(false)
  }
 })
})
