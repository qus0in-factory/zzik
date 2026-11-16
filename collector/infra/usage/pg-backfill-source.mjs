import {parseD1Envelope,normalizeD1Instant} from '../../../shared/d1-canonical.ts'
/** Never mutates PG. Full microsecond text survives until the pure order gate.
 * @param {{query:(sql:string,params?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>,maxBytes?:number}} options
 * @returns {{read():Promise<import('../../../shared/d1-contract.ts').D1Result<{events:Record<string,unknown>[],snapshots:Record<string,unknown>[]}>>}} */
export function createPgBackfillSource(options){
 return {/** @returns {Promise<import('../../../shared/d1-contract.ts').D1Result<{events:Record<string,unknown>[],snapshots:Record<string,unknown>[]}>>} */async read(){
  let transaction=false
  try{
   await options.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true
   const bad=await options.query("SELECT ((SELECT count(*) FROM usage_event WHERE jsonb_typeof(envelope) IS DISTINCT FROM 'object')+(SELECT count(*) FROM usage_snapshot WHERE jsonb_typeof(envelope) IS DISTINCT FROM 'object'))::text AS bad")
   if(bad.rows[0]?.bad!=='0'){await options.query('ROLLBACK');transaction=false;return {ok:false,reason:'non_object_envelope'}}
   /** @type {Record<string,unknown>[]} */const events=[]
   let after='0',bytes=0
   for(;;){
    const r=await options.query(`SELECT CAST(id AS TEXT) AS id,provider,status,to_char(run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "runAt",raw_sha256 AS "rawSha256",envelope::text AS "envelopeJson" FROM usage_event WHERE id>CAST($1 AS BIGINT) ORDER BY id LIMIT 250`,[after])
    for(const row of r.rows){bytes+=Buffer.byteLength(JSON.stringify(row),'utf8');if(bytes>(options.maxBytes??128*1024*1024))throw Error('source_limit');events.push(row)}
    if(r.rows.length<250)break
    const id=r.rows.at(-1)?.id;if(typeof id!=='string'||!/^[1-9]\d*$/.test(id))throw Error('invalid_id');after=id
   }
   const snapshots=await options.query(`SELECT NULL AS id,provider,status,to_char(run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "runAt",raw_sha256 AS "rawSha256",envelope::text AS "envelopeJson",floor(extract(epoch FROM updated_at)*1000)::bigint::text AS updated,floor(extract(epoch FROM fetched_at)*1000)::bigint::text AS fetched,collector_version AS version FROM usage_snapshot ORDER BY provider`)
   for(const row of snapshots.rows){
    const parsed=parseD1Envelope(row.envelopeJson),updated=Number(row.updated),fetched=row.fetched===null?null:Number(row.fetched)
    if(!parsed.ok||!Number.isSafeInteger(updated)||parsed.value.collectorVersion!==row.version)throw Error('snapshot_columns')
    const at=parsed.value.fetchedAt===null?null:normalizeD1Instant(parsed.value.fetchedAt)
    if(at!==null&&!at.ok||fetched!==(at?.ok?at.value.ms:null))throw Error('snapshot_columns')
    row.updatedAtMs=updated;delete row.updated;delete row.fetched;delete row.version
   }
   await options.query('COMMIT');transaction=false
   return {ok:true,value:{events,snapshots:snapshots.rows}}
  }catch{if(transaction)try{await options.query('ROLLBACK')}catch{}return {ok:false,reason:'pg_source_failed'}}
 }}
}
