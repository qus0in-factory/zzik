/** No assembly or env reads. Credentials stay inside this closure; never returned/logged. */
import { createHash } from 'node:crypto'
import { d1RetryAfterMs } from '../../domain/usage/d1-delivery-policy.mjs'
/** @typedef {import('../../domain/usage/d1-sender-types.ts').D1QueryPort} Query */
/** @typedef {import('../../domain/usage/d1-sender-types.ts').D1QueryResult} Outcome */
/** @param {{mode:string,dryRun:boolean,canRequest?:()=>boolean,control:import('../../domain/usage/d1-sender-types.ts').D1ControlPort,accountId:string,databaseId:string,token:string,clock:import('../../domain/usage/d1-sender-types.ts').D1Clock,wait:(ms:number)=>Promise<void>,fetch:import('../../domain/usage/d1-sender-types.ts').D1Fetch}} options @returns {Query} */
export function createD1RestClient(options) {
  let tail=Promise.resolve(),lastStart=-Infinity,blockedUntil=0,auth=false
  const credentialKey=createHash('sha256').update(options.token).digest('hex')
  const control=()=>{
    const r=options.control.read();if(!r.ok)return null
    if(r.value.credentialKey!==credentialKey){const next={...r.value,credentialKey,authStopped:false};if(!options.control.write(next).ok)return null;return next}
    return r.value
  }
  /** @param {'auth'|'invalid'|'retry'|'disabled'|'local'} reason @param {number|null} status @param {number} retryAfterMs @returns {Outcome} */
  const failure=(reason,status=null,retryAfterMs=0)=>({ok:false,reason,status,retryAfterMs})
  /** @param {readonly import('../../../shared/d1-contract.ts').D1SqlStatement[]} statements @returns {Promise<Outcome>} */
  const perform=async statements=>{
    if(options.mode!=='d1'||options.dryRun||options.canRequest?.()===false)return failure('disabled')
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
    try {
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('deadline'))},15000)})
      const work=async()=>{
        const response=await options.fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`,{
          method:'POST',headers:{Authorization:`Bearer ${options.token}`,'Content-Type':'application/json'},body:JSON.stringify({batch:statements}),signal:controller.signal})
        const status=response.status,after=d1RetryAfterMs(response.headers.get('Retry-After'),options.clock.now())
        observedStatus=status;observedAfter=after
        if(status===401||status===403){auth=true;const s=control();if(s===null||!options.control.write({...s,authStopped:true}).ok)return failure('local');return failure('auth',status)}
        if(status===429){blockedUntil=options.clock.now()+Math.max(1000,after);const s=control();if(s===null||!options.control.write({...s,nextRequestAtMs:blockedUntil}).ok)return failure('local')}
        if(status===400)return failure('invalid',status)
        if(status<200||status>=300)return failure('retry',status,after)
        const body=await response.json()
        if(body===null||typeof body!=='object')return failure('retry',status,after)
        const b=/** @type {{success?:unknown,result?:unknown}} */(body)
        if(b.success!==true||!Array.isArray(b.result)||b.result.length!==statements.length||!b.result.every(r=>r!==null&&typeof r==='object'&&r.success===true))return failure('retry',status,after)
        return /** @type {Outcome} */({ok:true,value:b.result})
      }
      return /** @type {Outcome} */(await Promise.race([work(),timeout]))
    }catch{return failure('retry',observedStatus,observedAfter)}
    finally{if(timer!==undefined)clearTimeout(timer)}
  }
  return {
    authStopped:()=>{const s=control();return s===null||s.authStopped},
    query(statements){
      const result=tail.then(()=>perform(statements))
      tail=result.then(()=>{},()=>{})
      return result.catch(()=>failure('retry'))
    },
  }
}
