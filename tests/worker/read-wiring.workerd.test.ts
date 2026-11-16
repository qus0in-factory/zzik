import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorker } from '../../worker/index'
import { createTestDb } from '../fakes/pglite-db'
import type { Env } from '../../worker/infra/env'
import type { SnapshotDatabase } from '../../worker/infra/usage/postgres-snapshot-store'

const providers = ['claude','codex','antigravity','opencode','grok','ollama'] as const
const at = '2026-11-16T00:00:00.000Z'
const bucketPath = '/api/usage-history/codex/buckets?from=2026-10-17T00%3A03%3A00.000Z&until=2026-11-16T00%3A03%3A00.000Z&bucketSec=900'
const env: Env = { ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com', ACCESS_AUD:'test', ALLOWED_EMAIL:'test@example.invalid', DB_URL:'synthetic', ASSETS:{fetch:async()=>new Response('fixture')} }
const request = (path:string, headers:Record<string,string>={}) => new Request('https://local'+path,{headers:{'Cf-Access-Jwt-Assertion':'synthetic',...headers}})

describe('Given the actual Worker composition with equivalent local D1 and PostgreSQL data',()=>{
 let mf:Miniflare, pg:Awaited<ReturnType<typeof createTestDb>>, pgWorker:ReturnType<typeof createWorker>
 beforeAll(async()=>{
  pg=await createTestDb()
  pgWorker=createWorker({createVerifier:()=>({verify:async()=>({ok:true,claims:{email:'test@example.invalid'}})}),connect:()=>({db:pg.db as SnapshotDatabase,close:async()=>{}})})
  const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../../',import.meta.url)),contents:`
   import {createWorker} from './worker/index.ts';
   let pgConnections=0,d1Queries=0;
   const worker=createWorker({connect:()=>{pgConnections++;throw Error('PG must not be selected in D1 mode')},createVerifier:()=>({verify:async()=>({ok:true,claims:{email:'test@example.invalid'}})})});
   export default {async fetch(request,env,ctx){
    if(new URL(request.url).pathname==='/__stats')return Response.json({pgConnections,d1Queries});
    const binding=env.DB;
    const selected={...env,DB:{prepare(sql){d1Queries++;return binding.prepare(sql)}},ASSETS:{fetch:async()=>new Response('fixture')}};
    const store=request.headers.get('X-Probe-Store');if(store!==null)selected.USAGE_READ_STORE=store;
    if(request.headers.has('X-Probe-No-Db'))delete selected.DB;
    return worker.fetch(request,selected,ctx);
   }};`},bundle:true,write:false,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],external:['cloudflare:sockets','node:*'],plugins:[{name:'node-builtins',setup(b){b.onResolve({filter:/.*/},a=>builtinModules.includes(a.path)?{path:a.path.startsWith('node:')?a.path:'node:'+a.path,external:true}:undefined)}}],logLevel:'silent'})
  mf=new Miniflare({workers:[{config:{name:'read-wiring-fixture',compatibilityDate:'2026-11-11',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'probe.mjs',modules:{'probe.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},env:{...Object.fromEntries(Object.entries({...env,ASSETS:undefined,USAGE_READ_STORE:'d1',USAGE_DATA_GENERATION:'0'}).filter(([,v])=>typeof v==='string').map(([k,value])=>[k,{type:'text',value}])),DB:{type:'d1',id:'read-wiring-fixture'}}}}],log:new Log(LogLevel.NONE)})
  const db=await mf.getD1Database('DB')
  const ddl=readFileSync(new URL('../../worker/migrations/0001_d1_storage.sql',import.meta.url),'utf8')
  for(const sql of ddl.replace(/^--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run()
  for(const [p,provider] of providers.entries()){
   const rawText=readFileSync(new URL(`../fixtures/${provider}-usage.normal.json`,import.meta.url),'utf8')
   const envelope={schema:1,provider,status:'ok',called:true,runAt:at,fetchedAt:at,intervalSec:900,rawText,rawRedacted:[]}
   await db.prepare('INSERT INTO usage_snapshot(provider,envelope,status,run_at,collector_version) VALUES(?,?,?,?,?)').bind(provider,JSON.stringify(envelope),'ok',Date.parse(at),'fixture').run()
   await pg.client.query('INSERT INTO usage_snapshot(provider,envelope,status,run_at,collector_version) VALUES($1,$2::jsonb,$3,$4,$5)',[provider,JSON.stringify(envelope),'ok',at,'fixture'])
   for(let i=0;i<3;i++){
    const id=(9007199254740992n+BigInt(p*10+i)).toString(),runAt=new Date(Date.parse(at)+i*60000).toISOString(),event={...envelope,runAt,fetchedAt:runAt}
    await db.prepare('INSERT INTO usage_event(id,provider,envelope,status,run_at) VALUES(CAST(? AS INTEGER),?,?,?,?)').bind(id,provider,JSON.stringify(event),'ok',Date.parse(runAt)).run()
    await pg.client.query('INSERT INTO usage_event(id,provider,envelope,status,run_at) OVERRIDING SYSTEM VALUE VALUES($1::bigint,$2,$3::jsonb,$4,$5)',[id,provider,JSON.stringify(event),'ok',runAt])
   }
  }
 },30000)
 afterAll(async()=>{await mf?.dispose();await pg?.close()})
 const d1Fetch=(path:string,headers:Record<string,string>={})=>mf.dispatchFetch('https://local'+path,{headers:{'Cf-Access-Jwt-Assertion':'synthetic',...headers}})
 const pgFetch=(path:string)=>pgWorker.fetch(request(path),env,{waitUntil(){}})
 const compare=async(path:string)=>{
  const [a,b]=await Promise.all([d1Fetch(path),pgFetch(path)])
  expect(a.status,path).toBe(b.status);expect(await a.json(),path).toEqual(await b.json())
  expect(a.headers.get('Cache-Control')).toBe(b.headers.get('Cache-Control'))
  return a.status
 }
 it('When D1 is selected Then alias, six snapshots and summary match PG while only D1 is queried',async()=>{
  const before=await (await d1Fetch('/__stats')).json() as {pgConnections:number,d1Queries:number}
  for(const path of ['/api/usage',...providers.map(p=>'/api/usage/'+p),'/api/usage-history'])expect(await compare(path)).toBe(200)
  const after=await (await d1Fetch('/__stats')).json() as typeof before
  expect(after.pgConnections).toBe(before.pgConnections);expect(after.d1Queries).toBeGreaterThan(before.d1Queries)
 })
 it('When history is paginated Then body, cursor, anchor and 64-bit id strings match PG',async()=>{
  for(const p of providers){
   const path='/api/usage-history/'+p+'?limit=2'
   expect(await compare(path)).toBe(200)
   const page=await (await d1Fetch(path)).json() as {samples:{id:string}[],nextCursor:string}
   expect(page.samples).toHaveLength(2);expect(page.samples.every(s=>typeof s.id==='string'&&BigInt(s.id)>BigInt(Number.MAX_SAFE_INTEGER))).toBe(true)
   expect(await compare(path+'&after='+encodeURIComponent(page.nextCursor))).toBe(200)
   expect(await compare('/api/usage-history/'+p+'?from=2026-11-16T00%3A01%3A00.000Z&anchor=1')).toBe(200)
  }
 })
 it('When the 30-day bucket route is called Then the D1 tail response also matches PG without a PG connection',async()=>{
  const before=await (await d1Fetch('/__stats')).json() as {pgConnections:number}
  expect(await compare(bucketPath)).toBe(200)
  expect((await (await d1Fetch('/__stats')).json() as typeof before).pgConnections).toBe(before.pgConnections)
 })
 it('When path or cursor is invalid Then error codes and bodies match PG',async()=>{
  for(const path of ['/api/usage/invalid','/api/usage-history/codex?after=invalid'])expect(await compare(path)).toBeGreaterThanOrEqual(400)
 })
 it('When the flag is invalid or D1 binding absent Then storage fails closed without PG fallback',async()=>{
  const before=await (await d1Fetch('/__stats')).json() as {pgConnections:number}
  const unavailableHeaders:Record<string,string>[]=[{'X-Probe-Store':'invalid'},{'X-Probe-No-Db':'1'}]
  for(const headers of unavailableHeaders)for(const path of ['/api/usage','/api/usage/codex','/api/usage-history','/api/usage-history/codex',bucketPath]){
   const r=await d1Fetch(path,headers);expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'storage_unavailable'})
  }
  expect((await (await d1Fetch('/__stats')).json() as typeof before).pgConnections).toBe(before.pgConnections)
 })
 it('When postgres is explicitly selected Then the existing PG connection path remains selected',async()=>{
  const before=await (await d1Fetch('/__stats')).json() as {pgConnections:number,d1Queries:number}
  const r=await d1Fetch('/api/usage/codex',{'X-Probe-Store':'postgres'});expect(r.status).toBe(503)
  const after=await (await d1Fetch('/__stats')).json() as typeof before
  expect(after.pgConnections).toBe(before.pgConnections+1);expect(after.d1Queries).toBe(before.d1Queries)
 })
})
