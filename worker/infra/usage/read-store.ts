export type UsageReadStore = 'd1'
export interface UsageReadStoreEnv { USAGE_READ_STORE?: string }
export type UsageReadStoreResult = {ok:true;store:'d1'} | {ok:false;reason:'storage_unavailable'}
/** G stage: D1 is implicit; stale or unknown selectors fail closed. */
export function resolveUsageReadStore(env:UsageReadStoreEnv):UsageReadStoreResult {
 return env.USAGE_READ_STORE===undefined || env.USAGE_READ_STORE==='' || env.USAGE_READ_STORE==='d1' ? {ok:true,store:'d1'} : {ok:false,reason:'storage_unavailable'}
}
