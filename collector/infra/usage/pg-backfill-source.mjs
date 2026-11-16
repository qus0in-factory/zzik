import {parseD1Envelope,normalizeD1Instant} from '../../../shared/d1-canonical.ts'
/** Never mutates PG. A consumer completes each page before the next query starts.
 * @param {{query:(sql:string,params?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>,maxBytes?:number,pageSize?:number}} options
 * @returns {import('../../domain/usage/d1-backfill-types.ts').BackfillPageSource & {read():Promise<import('../../../shared/d1-contract.ts').D1Result<{events:Record<string,unknown>[],snapshots:Record<string,unknown>[]}>>}} */
export function createPgBackfillSource(options){
 const size=options.pageSize??250
 /** @type {import('../../domain/usage/d1-backfill-types.ts').BackfillPageSource['scan']} */
 const scan=async consume=>{
  if(!Number.isSafeInteger(size)||size<1||size>250)return {ok:false,reason:'invalid_page_size'}
  let transaction=false
  try{
   await options.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');transaction=true
   const bad=await options.query("SELECT ((SELECT count(*) FROM usage_event WHERE jsonb_typeof(envelope) IS DISTINCT FROM 'object')+(SELECT count(*) FROM usage_snapshot WHERE jsonb_typeof(envelope) IS DISTINCT FROM 'object'))::text AS bad")
   if(bad.rows[0]?.bad!=='0'){await options.query('ROLLBACK');transaction=false;return {ok:false,reason:'non_object_envelope'}}
   // Independent SQL aggregates share this exact repeatable-read snapshot.
   const aggregate=await options.query('SELECT (SELECT COUNT(*)::text FROM usage_event) AS events,(SELECT COUNT(*)::text FROM usage_snapshot) AS snapshots,(SELECT MIN(id)::text FROM usage_event) AS "minId",(SELECT MAX(id)::text FROM usage_event) AS "maxId"')
   const groups=await options.query('SELECT provider,COUNT(*)::text AS n FROM usage_event GROUP BY provider ORDER BY provider')
   const raw=aggregate.rows[0]
   if(!raw||![raw.events,raw.snapshots].every(n=>typeof n==='string'&&/^\d+$/.test(n)&&Number.isSafeInteger(Number(n))))throw Error('invalid_source_facts')
   const eventsByProvider=Object.fromEntries(groups.rows.map(r=>[String(r.provider),Number(r.n)]))
   if(Object.values(eventsByProvider).some(n=>!Number.isSafeInteger(n)||n<0)||Object.values(eventsByProvider).reduce((a,b)=>a+b,0)!==Number(raw.events))throw Error('invalid_source_facts')
   const facts={events:Number(raw.events),snapshots:Number(raw.snapshots),minId:raw.minId===null?null:String(raw.minId),maxId:raw.maxId===null?null:String(raw.maxId),eventsByProvider}
   let seenEvents=0,seenSnapshots=0
   /** @type {string|null} */let finalId=null
   /** @type {string|null} */let firstId=null
   /** @type {Record<string,number>} */const seenProviders={}
   let after='0'
   for(;;){
    const r=await options.query(`SELECT CAST(id AS TEXT) AS id,provider,status,to_char(run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "runAt",raw_sha256 AS "rawSha256",envelope::text AS "envelopeJson" FROM usage_event WHERE id>CAST($1 AS BIGINT) ORDER BY usage_event.id LIMIT ${size}`,[after])
    for(const row of r.rows){seenEvents++;seenProviders[String(row.provider)]=(seenProviders[String(row.provider)]??0)+1;firstId??=String(row.id)}
    if(r.rows.length)finalId=String(r.rows.at(-1)?.id)
    if(r.rows.length>0){const accepted=await consume('event',r.rows);if(!accepted.ok){await options.query('ROLLBACK');transaction=false;return accepted}}
    if(r.rows.length<size)break
    const id=r.rows.at(-1)?.id;if(typeof id!=='string'||!/^[1-9]\d*$/.test(id)||BigInt(id)<=BigInt(after))throw Error('invalid_id');after=id
   }
   let afterProvider=''
   for(;;){
    const snapshots=await options.query(`SELECT NULL AS id,provider,status,to_char(run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "runAt",raw_sha256 AS "rawSha256",envelope::text AS "envelopeJson",floor(extract(epoch FROM updated_at)*1000)::bigint::text AS updated,floor(extract(epoch FROM fetched_at)*1000)::bigint::text AS fetched,collector_version AS version FROM usage_snapshot WHERE provider>$1 ORDER BY provider LIMIT ${size}`,[afterProvider])
    seenSnapshots+=snapshots.rows.length
    for(const row of snapshots.rows){
     const parsed=parseD1Envelope(row.envelopeJson),updated=Number(row.updated),fetched=row.fetched===null?null:Number(row.fetched)
     if(!parsed.ok||!Number.isSafeInteger(updated)||parsed.value.collectorVersion!==row.version)throw Error('snapshot_columns')
     const at=parsed.value.fetchedAt===null?null:normalizeD1Instant(parsed.value.fetchedAt)
     if(at!==null&&!at.ok||fetched!==(at?.ok?at.value.ms:null))throw Error('snapshot_columns')
     row.updatedAtMs=updated;delete row.updated;delete row.fetched;delete row.version
    }
    if(snapshots.rows.length>0){const accepted=await consume('snapshot',snapshots.rows);if(!accepted.ok){await options.query('ROLLBACK');transaction=false;return accepted}}
    if(snapshots.rows.length<size)break
    const provider=snapshots.rows.at(-1)?.provider;if(typeof provider!=='string'||provider<=afterProvider)throw Error('invalid_provider');afterProvider=provider
   }
   if(seenEvents!==facts.events||seenSnapshots!==facts.snapshots||firstId!==facts.minId||finalId!==facts.maxId||Object.entries(facts.eventsByProvider).some(([p,n])=>seenProviders[p]!==n)||Object.keys(seenProviders).length!==Object.keys(facts.eventsByProvider).length){await options.query('ROLLBACK');transaction=false;return {ok:false,reason:'pg_source_count_mismatch'}}
   await options.query('COMMIT');transaction=false
   return {ok:true,value:facts}
  }catch{if(transaction)try{await options.query('ROLLBACK')}catch{}return {ok:false,reason:'pg_source_failed'}}
 }
 return {scan,async read(){
  /** @type {Record<string,unknown>[]} */const events=[]
  /** @type {Record<string,unknown>[]} */const snapshots=[]
  let bytes=0
  const result=await scan((kind,rows)=>{
   for(const row of rows){
    // Explicit legacy budgets remain supported; the production streaming path has no byte cap.
    if(options.maxBytes!==undefined){bytes+=Buffer.byteLength(JSON.stringify(row),'utf8');if(bytes>options.maxBytes)return {ok:false,reason:'source_limit'}}
    ;(kind==='event'?events:snapshots).push(row)
   }
   return {ok:true,value:undefined}
  })
  return result.ok?{ok:true,value:{events,snapshots}}:result
 }}
}
