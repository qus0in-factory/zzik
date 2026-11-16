/** No assembly or env reads. Credentials stay inside this closure; never returned/logged. */
import { createHash } from 'node:crypto'
import { d1RetryAfterMs } from '../../domain/usage/d1-delivery-policy.mjs'
/** @typedef {import('../../domain/usage/d1-sender-types.ts').D1QueryPort} Query */
/** @typedef {import('../../domain/usage/d1-sender-types.ts').D1QueryResult} Outcome */
/** @param {{mode:string,dryRun:boolean,canRequest?:()=>boolean,control:import('../../domain/usage/d1-sender-types.ts').D1ControlPort,accountId:string,databaseId:string,token?:string,credentials?:import('../../domain/usage/d1-sender-types.ts').D1CredentialPort,clock:import('../../domain/usage/d1-sender-types.ts').D1Clock,wait:(ms:number)=>Promise<void>,fetch:import('../../domain/usage/d1-sender-types.ts').D1Fetch}} options @returns {Query} */
export function createD1RestClient(options) {
  let tail=Promise.resolve(),lastStart=-Infinity,blockedUntil=0,auth=false
  let token=options.token??'',credentialKey=options.token?createHash('sha256').update(options.token).digest('hex'):null
  const control=()=>{
    const r=options.control.read();if(!r.ok)return null
    if(credentialKey!==null&&r.value.credentialKey!==credentialKey){const next={...r.value,credentialKey,authStopped:false};if(!options.control.write(next).ok)return null;return next}
    return r.value
  }
  /** @param {'auth'|'invalid'|'retry'|'disabled'|'local'} reason @param {number|null} status @param {number} retryAfterMs @returns {Outcome} */
  const failure=(reason,status=null,retryAfterMs=0)=>({ok:false,reason,status,retryAfterMs})
  /** @param {number|null} status @returns {Outcome} */
  const stopAuth=status=>{auth=true;const s=control();if(s===null||!options.control.write({...s,authStopped:true}).ok)return failure('local');return failure('auth',status)}
  /** @param {readonly import('../../../shared/d1-contract.ts').D1SqlStatement[]} statements @param {boolean} [canRefresh] @returns {Promise<Outcome>} */
  const perform=async (statements,canRefresh=true)=>{
    if(options.mode!=='d1'||options.dryRun||options.canRequest?.()===false)return failure('disabled')
    if(auth)return failure('auth')
    if(options.credentials){
      try{
        const read=await options.credentials.get()
        if(!read.ok||!read.value.token.trim())return stopAuth(null)
        token=read.value.token;credentialKey=createHash('sha256').update(token).digest('hex')
      }catch{return stopAuth(null)}
    }
    const state=control();if(state===null)return failure('local')
    auth=state.authStopped
    if(auth)return failure('auth')
    blockedUntil=Math.max(blockedUntil,state.nextRequestAtMs)
    if(statements.length===0)return failure('invalid')
    const waitMs=Math.max(0,Math.max(lastStart+1000,blockedUntil)-options.clock.now())
    if(waitMs>0)await options.wait(waitMs)
    if(auth)return failure('auth')
    if(options.canRequest?.()===false)return failure('disabled')
    lastStart=options.clock.now()
    const current=control();if(current===null||!options.control.write({...current,nextRequestAtMs:lastStart+1000}).ok)return failure('local')
    const controller=new AbortController()
    /** @type {ReturnType<typeof setTimeout>|undefined} */let timer
    /** @type {number|null} */let observedStatus=null
    let observedAfter=0
    /** @type {Outcome} */let outcome
    try {
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'))},15000)})
      const work=async()=>{
        const response=await options.fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`,{
          method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({batch:statements}),signal:controller.signal})
        const status=response.status,after=d1RetryAfterMs(response.headers.get('Retry-After'),options.clock.now())
        observedStatus=status;observedAfter=after
        if(status===401||status===403)return failure('auth',status)
        if(status===429){blockedUntil=options.clock.now()+Math.max(1000,after);const s=control();if(s===null||!options.control.write({...s,nextRequestAtMs:blockedUntil}).ok)return failure('local')}
        if(status===400)return failure('invalid',status)
        if(status<200||status>=300)return failure('retry',status,after)
        const body=await response.json()
        if(body===null||typeof body!=='object')return failure('retry',status,after)
        const b=/** @type {{success?:unknown,result?:unknown}} */(body)
        if(b.success!==true||!Array.isArray(b.result)||b.result.length!==statements.length||!b.result.every(r=>r!==null&&typeof r==='object'&&r.success===true))return failure('retry',status,after)
        return /** @type {Outcome} */({ok:true,value:b.result})
      }
      outcome=/** @type {Outcome} */(await Promise.race([work(),timeout]))
    }catch{outcome=failure('retry',observedStatus,observedAfter)}
    finally{if(timer!==undefined)clearTimeout(timer)}
    if(!outcome.ok&&outcome.reason==='auth'){
      if(outcome.status===401&&options.credentials&&canRefresh){
        try{
          const fresh=await options.credentials.refresh(token)
          if(fresh.ok&&fresh.value.token!==token){
            token=fresh.value.token;credentialKey=createHash('sha256').update(token).digest('hex')
            return perform(statements,false)
          }
        }catch{}
      }
      return stopAuth(outcome.status)
    }
    return outcome
  }
  return {
    authStopped:()=>{const s=control();return s===null||s.authStopped},
    query(statements){
      const result=tail.then(()=>perform(statements,true))
      tail=result.then(()=>{},()=>{})
      return result.catch(()=>failure('retry'))
    },
  }
}
