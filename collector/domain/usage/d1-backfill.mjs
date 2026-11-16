import {canonicalEnvelope,checkMigrationTimeOrder,normalizeD1Instant,parseD1Envelope} from '../../../shared/d1-canonical.ts'
import {migrationRowSha256,normalizeMigrationRow} from './d1-migration.mjs'
import {sha256Hex} from './envelope.mjs'
/** @typedef {import('./d1-backfill-types.ts').BackfillPlan} Plan */
/** @typedef {import('../../../shared/d1-contract.ts').D1MigrationRow} Row */
/** @param {{events:unknown[],snapshots:unknown[]}} source @returns {import('../../../shared/d1-contract.ts').D1Result<Plan>} */
export function planBackfill(source){
 const order=checkMigrationTimeOrder(source.events);if(!order.ok)return order
 /** @type {Plan['items']} */const items=[]
 const snapshots=new Set()
 for(const [kind,rows] of /** @type {['event'|'snapshot',unknown[]][]} */([['event',source.events],['snapshot',source.snapshots]]))for(const input of rows){
  const normalized=normalizeMigrationRow(input);if(!normalized.ok)return normalized
  const row=normalized.value
  if((kind==='snapshot')!==(row.id===null))return {ok:false,reason:'invalid_migration_identity'}
  if(kind==='snapshot'&&snapshots.has(row.provider))return {ok:false,reason:'duplicate_snapshot'}
  snapshots.add(kind==='snapshot'?row.provider:'')
  const canonical=canonicalEnvelope(row.envelopeJson);if(!canonical.ok)return canonical
  const hash=migrationRowSha256(row);if(!hash.ok)return hash
  const extra=/** @type {{updatedAtMs?:unknown}} */(input)
  if(kind==='snapshot'&&(!Number.isSafeInteger(extra.updatedAtMs)||!Number.isFinite(new Date(/** @type {number} */(extra.updatedAtMs)).getTime())))return {ok:false,reason:'missing_snapshot_updated_at'}
  items.push({row:{...row,envelopeJson:canonical.value},sha256:hash.value,...(kind==='snapshot'?{updatedAtMs:/** @type {number} */(extra.updatedAtMs)}:{})})
 }
 items.sort((a,b)=>a.row.id===null?(b.row.id===null?a.row.provider.localeCompare(b.row.provider):1):b.row.id===null?-1:BigInt(a.row.id)<BigInt(b.row.id)?-1:BigInt(a.row.id)>BigInt(b.row.id)?1:0)
 const events=items.filter(item=>item.row.id!==null)
 const summary={events:events.length,snapshots:source.snapshots.length,minId:events[0]?.row.id??null,maxId:events.at(-1)?.row.id??null,planSha256:sha256Hex(JSON.stringify(items.map(i=>[i.row.id??i.row.provider,i.sha256,i.updatedAtMs??null])))}
 return {ok:true,value:{items,summary}}
}
/** @param {boolean} apply @param {string} confirmation @param {string} hash */
export function authorizeBackfill(apply,confirmation,hash){return !apply?{ok:true,value:false}:confirmation===`APPLY ${hash}`?{ok:true,value:true}:{ok:false,reason:'confirmation_required'}}
/** Runtime observations must not race a backfill. The NOT NULL failure rolls the whole D1 batch back. */
export const backfillGuard={sql:`INSERT INTO usage_write_receipt(operation_id,provider,write_seq,payload_sha256,created_at_ms)
SELECT NULL,'claude',0,'',0 WHERE EXISTS(SELECT 1 FROM usage_write_receipt) OR EXISTS(SELECT 1 FROM usage_snapshot WHERE write_seq<>0 OR operation_id IS NOT NULL) OR EXISTS(SELECT 1 FROM usage_event WHERE operation_id IS NOT NULL)`,params:[]}
/** @param {import('./d1-backfill-types.ts').BackfillRow} item @returns {import('../../../shared/d1-contract.ts').D1Result<import('../../../shared/d1-contract.ts').D1SqlStatement>} */
export function backfillStatement(item){
 const row=item.row,hash=migrationRowSha256(row),at=normalizeD1Instant(row.runAt),parsed=parseD1Envelope(row.envelopeJson)
 if(!hash.ok||hash.value!==item.sha256||!at.ok||!parsed.ok)return {ok:false,reason:'migration_hash_mismatch'}
 if(row.id!==null)return {ok:true,value:{sql:`INSERT INTO usage_event(id,provider,run_at,status,raw_sha256,envelope,operation_id) VALUES(CAST(? AS INTEGER),?,?,?,?,?,NULL)
ON CONFLICT(id) DO UPDATE SET envelope=CASE WHEN usage_event.provider=excluded.provider AND usage_event.run_at=excluded.run_at AND usage_event.status=excluded.status AND usage_event.raw_sha256 IS excluded.raw_sha256 AND usage_event.envelope=excluded.envelope AND usage_event.operation_id IS NULL THEN usage_event.envelope ELSE NULL END`,params:[row.id,row.provider,at.value.ms,row.status,row.rawSha256,row.envelopeJson]}}
 const env=parsed.value,fetched=env.fetchedAt===null?null:normalizeD1Instant(env.fetchedAt)
 if(fetched!==null&&!fetched.ok)return fetched
 return {ok:true,value:{sql:`INSERT INTO usage_snapshot(provider,envelope,status,run_at,fetched_at,raw_sha256,collector_version,updated_at,write_seq,operation_id) VALUES(?,?,?,?,?,?,?,?,0,NULL)
ON CONFLICT(provider) DO UPDATE SET envelope=CASE WHEN usage_snapshot.write_seq=0 AND usage_snapshot.operation_id IS NULL AND (usage_snapshot.run_at<excluded.run_at OR usage_snapshot.envelope=excluded.envelope) THEN excluded.envelope ELSE NULL END,status=excluded.status,run_at=excluded.run_at,fetched_at=excluded.fetched_at,raw_sha256=excluded.raw_sha256,collector_version=excluded.collector_version,updated_at=excluded.updated_at`,params:[row.provider,row.envelopeJson,row.status,at.value.ms,fetched?.ok?fetched.value.ms:null,row.rawSha256,env.collectorVersion,item.updatedAtMs??at.value.ms]}}
}
