import {initialLedgerState,acceptObservation} from '../../../../collector/domain/usage/d1-ledger.mjs'
import {describe,it,expect} from 'vitest'
import {createD1Maintenance} from '../../../../collector/app/usage/d1-maintenance.mjs'
import {senderFixture} from '../../../fakes/d1-sender'
import {D1_NOW} from '../../../fakes/d1-contract'
function setup(extra:Record<string,unknown>={}){const h=senderFixture({initialLedgerState,acceptObservation});return {...h,maintenance:createD1Maintenance({mode:'d1',dryRun:false,control:h.control,query:h.query,clock:h.clock,notice:h.notice,...extra})}}
describe('Given a D1-only maintenance module on the shared request lane',()=>{
 it('When postgres or dry-run is active Then never reads export state or prunes',async()=>{
  for(const x of [{mode:'postgres'},{dryRun:true}]){const h=setup(x);await h.maintenance.checkHealth();await h.maintenance.prune(D1_NOW,30);expect(h.calls).toHaveLength(0);expect(h.notices).toHaveLength(0)}
 })
 it('When export is older than 36h, checkpoint stalls or read fails Then emits a safe notice and reads at most daily',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)-36*3600000-1}]},{results:[{provider:'codex',stalled_at_ms:1}]}]});await h.maintenance.checkHealth();await h.maintenance.checkHealth();expect(h.calls).toHaveLength(1);expect(h.notices).toHaveLength(2)
  h.advance(86400000);h.responses.push({ok:false,reason:'retry',status:503,retryAfterMs:0});await h.maintenance.checkHealth();expect(h.calls).toHaveLength(2);expect(h.notices).toHaveLength(3)
 })
 it('When export and checkpoints are healthy Then sends no warning',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]});expect((await h.maintenance.checkHealth()).ok).toBe(true);expect(h.notices).toHaveLength(0)
 })
 it('When maintenance restarts Then preserves the daily health-read checkpoint',async()=>{
  const h=setup();h.responses.push({ok:true,value:[{results:[{ran_at_ms:Date.parse(D1_NOW)}]},{results:[]}]});await h.maintenance.checkHealth()
  const restarted=createD1Maintenance({mode:'d1',dryRun:false,control:h.control,query:h.query,clock:h.clock,notice:h.notice})
  await restarted.checkHealth();expect(h.calls).toHaveLength(1)
 })
 it('When pruning Then uses separate provider-specific 500-row event and receipt batches and advances only after all succeed',async()=>{
  const h=setup();for(let i=0;i<12;i++)h.responses.push({ok:true,value:[{meta:{changes:0}}]})
  expect(await h.maintenance.prune('2026-11-14T00:00:00Z',30)).toMatchObject({ok:true,lastPruneAt:D1_NOW})
  expect(h.calls).toHaveLength(12)
  for(const call of h.calls){const statements=call as {sql:string}[];expect(statements).toHaveLength(1);expect(statements[0].sql).toContain('LIMIT 500');expect(statements[0].sql).not.toContain('INSERT')}
  const fail=setup();fail.responses.push({ok:false,reason:'retry',status:500,retryAfterMs:0});expect(await fail.maintenance.prune('2026-11-14T00:00:00Z',30)).toMatchObject({ok:false,lastPruneAt:'2026-11-14T00:00:00Z'})
 })
 it('When lastPruneAt is unknown Then reports and skips immediate deletion',async()=>{
  const h=setup();expect(await h.maintenance.prune(null,30)).toMatchObject({ok:false,reason:'prune_time_unknown'});expect(h.calls).toHaveLength(0);expect(h.notices).toHaveLength(1)
 })
})
