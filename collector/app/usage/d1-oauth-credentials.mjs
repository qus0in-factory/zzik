// One refresh lane across every credential provider in this process. Each queued
// caller re-reads the file, so concurrent expiry/401 observations share one refresh.
/** @typedef {import('../../../shared/d1-contract.ts').D1Result<import('../../domain/usage/d1-sender-types.ts').D1Credential>} Result */
let refreshTail=Promise.resolve()
/** @type {Map<string,Promise<Result>>} */const inFlight=new Map()
/** @param {{file:import('../../domain/usage/d1-sender-types.ts').WranglerOAuthFilePort,refresh:import('../../domain/usage/d1-sender-types.ts').OAuthRefreshPort,clock:{now():number},refreshBeforeMs?:number}} options
 * @returns {import('../../domain/usage/d1-sender-types.ts').D1CredentialPort} */
export function createWranglerOAuthCredentials(options){
 const window=options.refreshBeforeMs??60000
 const failure=()=>/** @type {const} */({ok:false,reason:'oauth_credentials_unavailable'})
 /** @param {string|undefined} rejectedToken @returns {Promise<Result>} */
 const ensure=async rejectedToken=>{
  try{
   const read=options.file.read();if(!read.ok)return failure()
   const current=read.value,valid=current.expiresAtMs>options.clock.now()+window
   if(valid&&(rejectedToken===undefined||current.token!==rejectedToken))return {ok:true,value:{token:current.token}}
   const pending=inFlight.get(current.token);if(pending)return await pending
   /** @returns {Promise<Result>} */
   const refreshOne=async()=>{
    try{
     const latest=options.file.read();if(!latest.ok)return failure()
     const c=latest.value,fresh=c.expiresAtMs>options.clock.now()+window
     if(fresh&&(rejectedToken===undefined||c.token!==rejectedToken))return {ok:true,value:{token:c.token}}
     if(!options.file.expire(c.token).ok)return failure()
     if(!(await options.refresh.run()).ok)return failure()
     const after=options.file.read()
     if(!after.ok||after.value.token===c.token||after.value.expiresAtMs<=options.clock.now()+window)return failure()
     return {ok:true,value:{token:after.value.token}}
    }catch{return failure()}
   }
   const refreshed=refreshTail.then(refreshOne)
   inFlight.set(current.token,refreshed)
   refreshTail=refreshed.then(()=>{},()=>{})
   try{return await refreshed}finally{if(inFlight.get(current.token)===refreshed)inFlight.delete(current.token)}
  }catch{return failure()}
 }
 return {get:()=>ensure(undefined),refresh:token=>ensure(token)}
}
