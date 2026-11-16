/** @param {import('../../domain/usage/d1-sender-types.ts').D1QueryPort} query @returns {import('../../domain/usage/d1-backfill-types.ts').BackfillDestination} */
export function createD1BackfillDestination(query){
 return {
  async inspect(){
   const r=await query.query([{sql:`SELECT (SELECT COUNT(*) FROM usage_write_receipt) AS receipts,(SELECT COUNT(*) FROM usage_snapshot WHERE write_seq<>0 OR operation_id IS NOT NULL) AS dirtySnapshots,(SELECT COUNT(*) FROM usage_event WHERE operation_id IS NOT NULL) AS dirtyEvents,(SELECT COUNT(*) FROM usage_event) AS events,(SELECT COUNT(*) FROM usage_snapshot) AS snapshots,(SELECT CAST(MAX(id) AS TEXT) FROM usage_event) AS maxId,(SELECT CAST(seq AS TEXT) FROM sqlite_sequence WHERE name='usage_event') AS sequence`,params:[]}])
   if(!r.ok)return r
   const rows=/** @type {import('../../domain/usage/d1-backfill-types.ts').BackfillFacts[]|undefined} */(r.value[0]?.results),value=rows?.[0]
   if(!value||![value.receipts,value.dirtySnapshots,value.dirtyEvents,value.events,value.snapshots].every(n=>Number.isSafeInteger(n)&&n>=0)||![value.maxId,value.sequence].every(id=>id===null||typeof id==='string'&&/^[1-9]\d*$/.test(id)))return {ok:false,reason:'invalid_destination_facts'}
   return {ok:true,value}
  },
  async read(kind,keys){
   if(!keys.length)return {ok:true,value:[]}
   const event=kind==='event',r=await query.query([{sql:`SELECT ${event?'CAST(id AS TEXT)':'NULL'} AS id,provider,status,run_at AS runAtMs,raw_sha256 AS rawSha256,envelope AS envelopeJson FROM ${event?'usage_event':'usage_snapshot'} WHERE ${event?'id':'provider'} IN (${keys.map(()=>event?'CAST(? AS INTEGER)':'?').join(',')})`,params:keys}])
   if(!r.ok)return r
   const rows=/** @type {Record<string,unknown>[]|undefined} */(r.value[0]?.results)
   if(!Array.isArray(rows))return {ok:false,reason:'invalid_destination_rows'}
   return {ok:true,value:rows.map(row=>/** @type {import('../../../shared/d1-contract.ts').D1MigrationRow} */({...row,runAt:new Date(/** @type {number} */(row.runAtMs)).toISOString()}))}
  },
  async write(statements){const r=await query.query(statements);return r.ok?{ok:true,value:undefined}:r},
 }
}
