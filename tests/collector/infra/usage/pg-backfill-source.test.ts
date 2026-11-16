import {describe,it,expect} from 'vitest'
import {createTestDb} from '../../../fakes/pglite-db'
import {createPgBackfillSource} from '../../../../collector/infra/usage/pg-backfill-source.mjs'
import {planBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {d1Envelope,successValue} from '../../../fakes/d1-contract'
describe('Given a synthetic PG repeatable-read migration snapshot',()=>{
 it('When jsonb is a scalar Then fails closed and leaves no open transaction',async()=>{
  const db=await createTestDb();try{await db.client.query("INSERT INTO usage_event(provider,status,run_at,envelope) VALUES('claude','ok',now(),'42'::jsonb)");const source=createPgBackfillSource({query:(sql:string,p?:unknown[])=>db.client.query(sql,p)});expect(await source.read()).toMatchObject({ok:false,reason:'non_object_envelope'});await db.client.query('BEGIN');await db.client.query('ROLLBACK')}finally{await db.close()}
 })
 it('When the source byte limit is reached Then returns source_limit separately from pg_source_failed',async()=>{
  const db=await createTestDb();try{
   await db.client.query("INSERT INTO usage_event(provider,status,run_at,envelope) VALUES('claude','ok',now(),$1::jsonb)",[JSON.stringify(d1Envelope())])
   const result=await createPgBackfillSource({query:(sql:string,p?:unknown[])=>db.client.query(sql,p),maxBytes:1}).read()
   expect(result).toEqual({ok:false,reason:'source_limit'})
   await db.client.query('BEGIN');await db.client.query('ROLLBACK')
  }finally{await db.close()}
 })
 it('When PG times have microseconds Then preserves precision for the order gate and ids above JS safe integer',async()=>{
  const db=await createTestDb();try{
   for(const [id,at] of [['9007199254740993','2026-11-16T03:00:00.123100Z'],['9007199254740992','2026-11-16T03:00:00.123900Z']])await db.client.query('INSERT INTO usage_event(id,provider,status,run_at,envelope) OVERRIDING SYSTEM VALUE VALUES($1,\'claude\',\'ok\',$2,$3::jsonb)',[id,at,JSON.stringify(d1Envelope())])
   const rows=successValue(await createPgBackfillSource({query:(sql:string,p?:unknown[])=>db.client.query(sql,p)}).read());expect(rows.events[0].id).toBe('9007199254740992');expect(rows.events[0].runAt).toMatch(/123900Z$/);expect(planBackfill(rows)).toMatchObject({ok:false,reason:'millisecond_order_changed'})
  }finally{await db.close()}
 })
})

describe('Given a paged source consumer instead of an in-memory source array',()=>{
 it('When the consumer is delayed Then never reads ahead and does not apply the legacy byte cap',async()=>{
  const rows=['1','2','3'].map(id=>({id,provider:'claude',status:'ok',runAt:'2026-11-16T03:00:00.123Z',rawSha256:null,envelopeJson:JSON.stringify(d1Envelope())}))
  let eventQueries=0,release!:()=>void,entered!:()=>void;const enteredPromise=new Promise<void>(r=>{entered=r})
  const source=createPgBackfillSource({pageSize:2,maxBytes:1,query:async(sql:string,params?:unknown[])=>{
   if(sql.includes('jsonb_typeof'))return {rows:[{bad:'0'}]}
   if(sql.includes('AS events,'))return {rows:[{events:'3',snapshots:'0',minId:'1',maxId:'3'}]}
   if(sql.includes('GROUP BY provider'))return {rows:[{provider:'claude',n:'3'}]}
   if(sql.includes('WHERE id>')){eventQueries++;return {rows:rows.filter(r=>BigInt(r.id)>BigInt(String(params?.[0]))).slice(0,2)}}
   return {rows:[]}
  }})
  const seen:string[]=[]
  const done=source.scan(async(kind,page)=>{if(kind==='event'){seen.push(...page.map(r=>String(r.id)));if(seen.length===2){entered();await new Promise<void>(r=>{release=r})}}return {ok:true,value:undefined}})
  await enteredPromise;expect(eventQueries).toBe(1);release();expect((await done).ok).toBe(true);expect(eventQueries).toBe(2);expect(seen).toEqual(['1','2','3'])
 })
})

import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBackfillSpool} from '../../../../collector/infra/usage/backfill-spool.mjs'
import {D1_NOW} from '../../../fakes/d1-contract'
describe('Given actual synthetic PG event and snapshot rows',()=>{
 it('When scanned one row at a time Then preserves the legacy full-source digest and snapshot metadata',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-pg-plan-')),db=await createTestDb(),spool=successValue(createBackfillSpool({directory,pageSize:1}))
  try{
   for(const id of ['9007199254740993','9'])await db.client.query("INSERT INTO usage_event(id,provider,status,run_at,envelope) OVERRIDING SYSTEM VALUE VALUES($1,'claude','ok',$2,$3::jsonb)",[id,D1_NOW,JSON.stringify(d1Envelope())])
   for(const provider of ['codex','claude'] as const)await db.client.query("INSERT INTO usage_snapshot(provider,status,run_at,fetched_at,envelope,collector_version,updated_at) VALUES($1,'ok',$2,$2,$3::jsonb,'0.6.20',$2)",[provider,D1_NOW,JSON.stringify(d1Envelope({provider}))])
   const query=(sql:string,params?:unknown[])=>db.client.query<Record<string,unknown>>(sql,params),old=successValue(planBackfill(successValue(await createPgBackfillSource({query}).read())))
   let max=0;successValue(await createPgBackfillSource({query,pageSize:1}).scan((kind,rows)=>{max=Math.max(max,rows.length);return spool.append(kind,rows)}))
   expect(max).toBe(1);expect(successValue(spool.seal()).summary).toEqual(old.summary)
  }finally{spool.close();await db.close();rmSync(directory,{recursive:true,force:true})}
 })
})

describe('Given more than 250 PG events crossing decimal digit boundaries',()=>{
 it('When planned from one repeatable-read snapshot Then copies every numeric ID and matches independent COUNT(*)',async()=>{
  const db=await createTestDb()
  try{
   await db.client.query("INSERT INTO usage_event(id,provider,status,run_at,envelope) OVERRIDING SYSTEM VALUE SELECT n,'claude','ok',$1,$2::jsonb FROM generate_series(12,1432) AS n",[D1_NOW,JSON.stringify(d1Envelope())])
   let transaction=false,countedInTransaction=false
   const query=async(sql:string,p?:unknown[])=>{
    if(sql.startsWith('BEGIN'))transaction=true
    if(sql.includes('AS events,')){expect(transaction).toBe(true);countedInTransaction=true}
    const result=await db.client.query<Record<string,unknown>>(sql,p)
    if(sql==='COMMIT'||sql==='ROLLBACK')transaction=false
    return result
   }
   const source=createPgBackfillSource({query}),read=successValue(await source.read()),plan=successValue(planBackfill(read))
   expect(countedInTransaction).toBe(true);expect(transaction).toBe(false)
   const count=await db.client.query<{n:number}>('SELECT COUNT(*)::int AS n FROM usage_event')
   expect(plan.summary.events).toBe(count.rows[0].n);expect(plan.summary.events).toBe(1421)
   expect(read.events.map(r=>r.id)).toEqual(Array.from({length:1421},(_,i)=>String(i+12)))
   expect(read.events.map(r=>r.id)).toEqual(expect.arrayContaining(['12','100','1000','261','262','511','512']))
  }finally{await db.close()}
 })
 it('When a faulty page source drops one original row Then rejects against same-transaction PG COUNT(*)',async()=>{
  const db=await createTestDb()
  try{
   await db.client.query("INSERT INTO usage_event(id,provider,status,run_at,envelope) OVERRIDING SYSTEM VALUE SELECT n,'claude','ok',$1,$2::jsonb FROM generate_series(12,1012) AS n",[D1_NOW,JSON.stringify(d1Envelope())])
   const source=createPgBackfillSource({query:async(sql:string,p?:unknown[])=>{const r=await db.client.query<Record<string,unknown>>(sql,p);if(sql.includes('WHERE id>'))r.rows=r.rows.filter(row=>row.id!=='100');return r}})
   expect(await source.scan(()=>({ok:true,value:undefined}))).toMatchObject({ok:false,reason:'pg_source_count_mismatch'})
  }finally{await db.close()}
 })
})
