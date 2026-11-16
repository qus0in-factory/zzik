import {DEFAULT_COLLECTOR_OAUTH_PROFILE,isCollectorOAuthProfile} from './d1-oauth-profile.mjs'
import {readIntervalPolicy} from './interval-policy.mjs'
/** @param {Record<string,string|undefined>} env @param {{dryRun?:boolean,capability?:unknown}} options
 * @returns {{ok:true,mode:'postgres'|'d1',intervalSec:number,retentionDays:number,intervals?:Record<string,number>,oauthProfile?:string}|{ok:false,reason:string}}
 */
export function readStorageConfig(env, options = {}) {
  const mode = env.ZZIK_STORE ?? 'postgres'
  if (mode !== 'postgres' && mode !== 'd1') return {ok:false,reason:'InvalidStoreMode'}
  if (!options.dryRun && mode==='postgres' && !env.DB_URL?.trim()) return {ok:false,reason:'MissingDatabaseConfiguration'}
  const auth=env.ZZIK_D1_AUTH??'api-token'
  if(mode==='d1'&&!['api-token','wrangler-oauth'].includes(auth))return {ok:false,reason:'InvalidD1AuthMode'}
  if(!options.dryRun && mode==='d1' && (auth==='api-token'&&!env.ZZIK_D1_API_TOKEN?.trim()||!env.ZZIK_D1_ACCOUNT_ID?.trim()||!env.ZZIK_D1_DATABASE_ID?.trim()))return {ok:false,reason:'MissingD1Configuration'}
  const oauthProfile=env.ZZIK_D1_OAUTH_PROFILE??DEFAULT_COLLECTOR_OAUTH_PROFILE
  if(mode==='d1'&&auth==='wrangler-oauth'&&!isCollectorOAuthProfile(oauthProfile))return {ok:false,reason:'InvalidD1OAuthProfile'}
  const intervalSec = env.ZZIK_INTERVAL_SEC === undefined ? 900 : Number(env.ZZIK_INTERVAL_SEC)
  const retentionDays = env.ZZIK_EVENT_RETENTION_DAYS === undefined ? 30 : Number(env.ZZIK_EVENT_RETENTION_DAYS)
  const policy=readIntervalPolicy(env,{mode,capability:options.capability??null})
  if(!policy.ok)return {ok:false,reason:policy.reason}
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return {ok:false,reason:'InvalidRetentionDays'}
  return {ok:true,mode,intervalSec,retentionDays,...(mode==='d1'?{intervals:policy.value}:{}),...(mode==='d1'&&auth==='wrangler-oauth'?{oauthProfile}:{})}
}
