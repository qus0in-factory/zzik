import {describe,it,expect} from 'vitest'
import {planBackfill,authorizeBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {D1_NOW,d1Envelope,successValue} from '../../../fakes/d1-contract'
const event=(id:string,runAt=D1_NOW)=>({id,provider:'claude',status:'ok',runAt,rawSha256:null,envelopeJson:JSON.stringify(d1Envelope({runAt}))})
describe('Given frozen PG rows for a backfill plan',()=>{
 it('When a jsonb value is not an object Then rejects it before any destination writes',()=>{
  for(const envelopeJson of ['[]','null','42','"wrapped"'])expect(planBackfill({events:[{...event('1'),envelopeJson}],snapshots:[]}).ok).toBe(false)
 })
 it('When sub-ms truncation changes provider ordering Then stops; otherwise preserves ids as strings and hashes the full envelope',()=>{
  expect(planBackfill({events:[event('2','2026-11-16T03:00:00.123100Z'),event('1','2026-11-16T03:00:00.123900Z')],snapshots:[]}).ok).toBe(false)
  const plan=successValue(planBackfill({events:[event('9007199254740993'),event('9007199254740992')],snapshots:[]}))
  expect(plan.summary).toMatchObject({events:2,minId:'9007199254740992',maxId:'9007199254740993'})
  const changed=successValue(planBackfill({events:[{...event('9007199254740993'),envelopeJson:JSON.stringify(d1Envelope({intervalSec:180}))},event('9007199254740992')],snapshots:[]}))
  expect(changed.summary.planSha256).not.toBe(plan.summary.planSha256)
 })
 it('When actual writes are requested Then requires both the apply flag and exact confirmation for this plan',()=>{
  const p=successValue(planBackfill({events:[event('1')],snapshots:[]}))
  expect(authorizeBackfill(false,'',p.summary.planSha256)).toEqual({ok:true,value:false})
  expect(authorizeBackfill(true,'yes',p.summary.planSha256).ok).toBe(false)
  expect(authorizeBackfill(true,`APPLY ${p.summary.planSha256}`,p.summary.planSha256)).toEqual({ok:true,value:true})
 })
})
