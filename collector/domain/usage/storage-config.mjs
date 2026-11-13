/** @param {Record<string,string|undefined>} env @param {{dryRun?:boolean}} options
 * @returns {{ok:true,mode:'postgres',intervalSec:number,retentionDays:number}|{ok:false,reason:string}}
 */
export function readStorageConfig(env, options = {}) {
  const mode = env.ZZIK_STORE ?? 'postgres'
  if (mode !== 'postgres') return {ok:false,reason:'InvalidStoreMode'}
  if (!options.dryRun && !env.DB_URL?.trim()) return {ok:false,reason:'MissingDatabaseConfiguration'}
  const intervalSec = env.ZZIK_INTERVAL_SEC === undefined ? 900 : Number(env.ZZIK_INTERVAL_SEC)
  const retentionDays = env.ZZIK_EVENT_RETENTION_DAYS === undefined ? 30 : Number(env.ZZIK_EVENT_RETENTION_DAYS)
  if (!Number.isInteger(intervalSec) || intervalSec <= 0) return {ok:false,reason:'InvalidInterval'}
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return {ok:false,reason:'InvalidRetentionDays'}
  return {ok:true,mode,intervalSec,retentionDays}
}
