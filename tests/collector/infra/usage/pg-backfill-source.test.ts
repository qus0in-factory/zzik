import {describe,it,expect} from 'vitest'
import {createTestDb} from '../../../fakes/pglite-db'
import {createPgBackfillSource} from '../../../../collector/infra/usage/pg-backfill-source.mjs'
import {planBackfill} from '../../../../collector/domain/usage/d1-backfill.mjs'
import {d1Envelope,successValue} from '../../../fakes/d1-contract'
describe('Given a synthetic PG repeatable-read migration snapshot',()=>{
 it('When jsonb is a scalar Then fails closed and leaves no open transaction',async()=>{
  const db=await createTestDb();try{await db.client.query("INSERT INTO usage_event(provider,status,run_at,envelope) VALUES('claude','ok',now(),'42'::jsonb)");const source=createPgBackfillSource({query:(sql:string,p?:unknown[])=>db.client.query(sql,p)});expect(await source.read()).toMatchObject({ok:false,reason:'non_object_envelope'});await db.client.query('BEGIN');await db.client.query('ROLLBACK')}finally{await db.close()}
 })
 it('When PG times have microseconds Then preserves precision for the order gate and ids above JS safe integer',async()=>{
  const db=await createTestDb();try{
   for(const [id,at] of [['9007199254740993','2026-11-16T03:00:00.123100Z'],['9007199254740992','2026-11-16T03:00:00.123900Z']])await db.client.query('INSERT INTO usage_event(id,provider,status,run_at,envelope) OVERRIDING SYSTEM VALUE VALUES($1,\'claude\',\'ok\',$2,$3::jsonb)',[id,at,JSON.stringify(d1Envelope())])
   const rows=successValue(await createPgBackfillSource({query:(sql:string,p?:unknown[])=>db.client.query(sql,p)}).read());expect(rows.events[0].id).toBe('9007199254740992');expect(rows.events[0].runAt).toMatch(/123900Z$/);expect(planBackfill(rows)).toMatchObject({ok:false,reason:'millisecond_order_changed'})
  }finally{await db.close()}
 })
})
