import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createPgBackfillSource} from '../../../../collector/infra/usage/pg-backfill-source.mjs'
import {createBackfillSpool} from '../../../../collector/infra/usage/backfill-spool.mjs'
import {D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
describe('Given a source whose total envelopes exceed the previous 128MiB budget',()=>{
 it('When streaming to disk Then seals and replays every row using only bounded pages',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-large-plan-')),spool=successValue(createBackfillSpool({directory,pageSize:25}))
  const total=2050,base=9007199254740992n,envelopeJson=JSON.stringify(d1Envelope({rawText:JSON.stringify({five_hour:{utilization:37},padding:'x'.repeat(65536)})}))
  let bytes=0,maxPage=0
  const source=createPgBackfillSource({pageSize:50,maxBytes:128*1024*1024,query:async(sql:string,params?:unknown[])=>{
   if(sql.includes('jsonb_typeof'))return {rows:[{bad:'0'}]}
   if(sql.includes('AS events,'))return {rows:[{events:String(total),snapshots:'0',minId:base.toString(),maxId:(base+BigInt(total-1)).toString()}]}
   if(sql.includes('GROUP BY provider'))return {rows:[{provider:'claude',n:String(total)}]}
   if(sql.includes('WHERE id>')){const after=String(params?.[0]),start=after==='0'?0:Number(BigInt(after)-base+1n);return {rows:Array.from({length:Math.max(0,Math.min(50,total-start))},(_,i)=>({id:(base+BigInt(start+i)).toString(),provider:'claude',status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson}))}}
   return {rows:[]}
  }})
  try{
   successValue(await source.scan((kind,rows)=>{maxPage=Math.max(maxPage,rows.length);for(const row of rows)bytes+=Buffer.byteLength(String(row.envelopeJson));return spool.append(kind,rows)}))
   expect(bytes).toBeGreaterThan(128*1024*1024);expect(maxPage).toBeLessThanOrEqual(50)
   const plan=successValue(spool.seal());expect('items' in plan).toBe(false);expect(plan.summary).toMatchObject({events:total,minId:base.toString(),maxId:(base+BigInt(total-1)).toString()})
   let replayed=0;for await(const page of plan.pages()){expect(page.length).toBeLessThanOrEqual(25);replayed+=page.length}expect(replayed).toBe(total)
   const own=join(directory,readdirSync(directory)[0]);expect(readdirSync(own).reduce((sum,name)=>sum+statSync(join(own,name)).size,0)).toBeGreaterThan(128*1024*1024)
  }finally{spool.close();rmSync(directory,{recursive:true,force:true})}
 },30000)
})
