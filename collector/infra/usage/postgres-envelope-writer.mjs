import { safeStoreError } from './store-error.mjs'
/** @typedef {import('../../domain/usage/ports.mjs').StoreMeta} StoreMeta */
/** @typedef {import('../../domain/usage/ports.mjs').StoreWriteResult} StoreWriteResult */
/** @param {{execute:(text:string,params?:any[])=>Promise<any>}} deps */
export function createPostgresEnvelopeWriter({ execute }) {
  return {
    /** @param {string} value @param {StoreMeta} meta @returns {Promise<StoreWriteResult>} */
    async write(value, meta) {
      try {
        await execute('BEGIN')
        await execute("SET LOCAL statement_timeout = '10s'")
        await execute(`INSERT INTO usage_snapshot
          (provider,envelope,status,run_at,fetched_at,raw_sha256,collector_version,updated_at)
          VALUES ($1,$2::jsonb,$3,$4::timestamptz,$5::timestamptz,$6,$7,now())
          ON CONFLICT (provider) DO UPDATE SET envelope=excluded.envelope,status=excluded.status,
          run_at=excluded.run_at,fetched_at=excluded.fetched_at,raw_sha256=excluded.raw_sha256,
          collector_version=excluded.collector_version,updated_at=now()`,
          [meta.provider,value,meta.status,meta.runAt,meta.fetchedAt,meta.rawSha256,meta.collectorVersion])
        if (meta.changed) {
          await execute('INSERT INTO usage_event (provider,run_at,status,raw_sha256,envelope) VALUES ($1,$2::timestamptz,$3,$4,$5::jsonb)',
            [meta.provider,meta.runAt,meta.status,meta.rawSha256,value])
        }
        await execute('COMMIT')
        return {ok:true}
      } catch (error) {
        try { await execute('ROLLBACK') } catch { /* best effort; driver reconnects */ }
        return {ok:false,httpStatus:null,message:safeStoreError(error)}
      }
    },
    /** @param {number} retentionDays @returns {Promise<{ok:true,deleted:number}|{ok:false,message:string}>} */
    async prune(retentionDays) {
      if (!Number.isInteger(retentionDays) || retentionDays <= 0) return {ok:false,message:'InvalidRetentionDays'}
      try {
        await execute('BEGIN')
        await execute("SET LOCAL statement_timeout = '10s'")
        const result = await execute("DELETE FROM usage_event WHERE run_at < now() - ($1 * interval '1 day') RETURNING id", [retentionDays])
        await execute('COMMIT')
        return {ok:true,deleted:result.rows?.length ?? result.length ?? result.count ?? result.affectedRows ?? 0}
      } catch (error) {
        try { await execute('ROLLBACK') } catch { /* best effort */ }
        return {ok:false,message:safeStoreError(error)}
      }
    },
  }
}
