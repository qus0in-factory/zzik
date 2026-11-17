import { USAGE_PROVIDERS } from './providers.mjs'
/** @param {Record<string,string|undefined>} env @param {{mode:string,capability:unknown}} options
 * @returns {{ok:true,value:Record<string,number>}|{ok:false,reason:string,exitCode:78}} */
export function readIntervalPolicy(env,{mode,capability}){
 const cap=/** @type {{v?:unknown,readStore?:unknown,bucketRoute?:unknown}|null} */(capability)
 const enabled=mode==='d1'&&cap!==null&&typeof cap==='object'&&cap.v===1&&cap.readStore==='d1'&&cap.bucketRoute===true
 const base=Number(env.ZZIK_INTERVAL_SEC??900)
 if(!Number.isSafeInteger(base)||base<900)return {ok:false,reason:'InvalidInterval',exitCode:78}
 /** @type {Record<string,number>} */const value={}
 for(const provider of USAGE_PROVIDERS){
  const interval=Number(env[`ZZIK_INTERVAL_SEC_${provider.toUpperCase()}`]??base)
  // claude stays at 900 even with a valid D1 capability (ADR §2/§11 F).
  const minimum=provider==='claude'?900:enabled?180:900
  if(!Number.isSafeInteger(interval)||interval<minimum)return {ok:false,reason:'InvalidProviderInterval',exitCode:78}
  value[provider]=interval
 }
 return {ok:true,value}
}
