import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync,readdirSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBackfillSpool} from '../../../../collector/infra/usage/backfill-spool.mjs'
import {planBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
const event=(id:string,runAt=D1_NOW)=>({id,provider:'claude',status:'ok',runAt,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope({runAt}))})
describe('Given a bounded private disk plan spool',()=>{
 it('When pages arrive in different order Then yields the legacy numeric-id/provider order and exact pre-change hash',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-plan-'))
  const source={events:['9007199254740993','9','100'].map(id=>event(id)),snapshots:['codex','claude'].map(provider=>({id:null,provider,status:'ok',runAt:D1_NOW,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope({provider:provider as 'codex'|'claude'})),updatedAtMs:Date.parse(D1_NOW)}))}
  try{
   const spool=successValue(createBackfillSpool({directory,pageSize:2}))
   successValue(spool.append('event',source.events.slice(0,2)));successValue(spool.append('snapshot',source.snapshots));successValue(spool.append('event',source.events.slice(2)))
   const plan=successValue(spool.seal());expect(plan.summary).toEqual(successValue(planBackfill(source)).summary)
   expect(plan.summary.planSha256).toBe('d093fbf6b3ddeb92175989292bf1980eff12317d4e1c8c70a9d2f65212d1ce78')
   for(let pass=0;pass<2;pass++){const keys:string[]=[];for await(const page of plan.pages()){expect(page.length).toBeLessThanOrEqual(2);keys.push(...page.map(i=>i.row.id??i.row.provider))}expect(keys).toEqual(['9','100','9007199254740993','claude','codex'])}
   expect(spool.append('event',[event('101')]).ok).toBe(false)
   const path=join(directory,readdirSync(directory)[0]);expect(statSync(path).mode&0o777).toBe(0o700)
   spool.close();expect(readdirSync(directory)).toEqual([])
  }finally{rmSync(directory,{recursive:true,force:true})}
 })
 it('When a sub-ms inversion spans separate pages Then rejects like the original order gate',()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-plan-order-')),spool=successValue(createBackfillSpool({directory,pageSize:1}))
  try{successValue(spool.append('event',[event('2','2026-11-16T03:00:00.123100Z')]));successValue(spool.append('event',[event('1','2026-11-16T03:00:00.123900Z')]));expect(spool.seal()).toEqual({ok:false,reason:'millisecond_order_changed'})}finally{spool.close();rmSync(directory,{recursive:true,force:true})}
 })
})

describe('Given full timestamp precision with offsets and pre-epoch dates',()=>{
 for(const inverted of [false,true])it(`When the same-ms order is ${inverted?'inverted':'preserved'} Then agrees with the original gate`,()=>{
  const directory=mkdtempSync(join(tmpdir(),'zzik-order-equivalence-')),spool=successValue(createBackfillSpool({directory,pageSize:1}))
  const rows=[event('1',`1969-12-31T23:59:59.999${inverted?'900':'100'}Z`),event('2',`1970-01-01T08:59:59.999${inverted?'100':'900'}+09:00`)]
  try{for(const row of rows)successValue(spool.append('event',[row]));const old=planBackfill({events:rows,snapshots:[]}),actual=spool.seal();if(old.ok)expect(actual).toMatchObject({ok:true,value:{summary:old.value.summary}});else expect(actual).toEqual(old)}finally{spool.close();rmSync(directory,{recursive:true,force:true})}
 })
})
