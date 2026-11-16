/** Manual tick only. B3 owns scheduling and assembly; no provider API or env access. */
import { buildD1WriteBatch } from '../../domain/usage/d1-write-contract.mjs'
import { acknowledgeOperation, breakChain } from '../../domain/usage/d1-ledger.mjs'
import { d1RetryDelay } from '../../domain/usage/d1-delivery-policy.mjs'
/** @typedef {import('../../domain/usage/d1-ledger-types.ts').LedgerPort} Ledger */
/** @typedef {import('../../../shared/usage-contract.ts').UsageProvider} Provider */
/** @param {{mode:string,dryRun:boolean,control:import('../../domain/usage/d1-sender-types.ts').D1ControlPort,ledger:Ledger,query:import('../../domain/usage/d1-sender-types.ts').D1QueryPort,clock:import('../../domain/usage/d1-sender-types.ts').D1Clock,random:()=>number,notice:import('../../domain/usage/d1-sender-types.ts').D1NoticePort,notifyAlerts:(alerts:unknown[])=>Promise<void>}} options */
export function createD1Sender(options) {
  let busy=false,auth=false,localFailed=false,globalDue=0
  /** @type {Provider|null} */let previousProvider=null
  /** @type {Map<Provider,string>} */const paused=new Map()
  const saved=options.control.read()
  if(!saved.ok)localFailed=true
  else{auth=saved.value.authStopped;for(const [provider,id] of Object.entries(saved.value.paused))paused.set(/** @type {Provider} */(provider),id)}
  /** @param {Provider} provider @param {string|null} operationId */
  const persistPause=(provider,operationId)=>{const s=options.control.read();if(!s.ok){localFailed=true;return false}const values={...s.value.paused};if(operationId===null)delete values[provider];else values[provider]=operationId;if(!options.control.write({...s.value,paused:values}).ok){localFailed=true;return false}if(operationId===null)paused.delete(provider);else paused.set(provider,operationId);return true}
  const enabled=()=>options.mode==='d1'&&!options.dryRun
  const stopped=()=>{const remote=options.query.authStopped();const s=options.control.read();if(s.ok)auth=s.value.authStopped;else localFailed=true;return auth||remote||localFailed}
  /** @param {string} reason @param {Provider|undefined} provider @param {number|null|undefined} status */
  const notify=async(reason,provider=undefined,status=undefined)=>{try{await options.notice.notify({reason,provider,status})}catch{/* webhook exactly-once is outside the contract */}}
  /** @param {Provider} provider */
  const canCollect=provider=>!enabled() || (!stopped()&&!paused.has(provider))
  return {
    canCollect,
    async tick(){
      if(!enabled())return {kvOk:false,reason:'disabled'}
      if(busy)return {kvOk:false,reason:'busy'}
      if(stopped())return {kvOk:false,reason:localFailed?'local_commit_failed':'auth_stopped'}
      if(options.clock.now()<globalDue)return {kvOk:false,reason:'global_backoff'}
      busy=true
      try {
        const pending=options.ledger.pending(options.clock.now())
        if(!pending.ok){localFailed=true;await notify('ledger_read_failed');return {kvOk:false,reason:pending.reason}}
        const rows=pending.value.filter(r=>!paused.has(r.operation.provider))
        if(rows.length===0)return {kvOk:false,reason:'idle'}
        const providers=rows.map(r=>r.operation.provider).sort()
        const provider=providers.find(p=>previousProvider===null||p>previousProvider)??providers[0]
        const row=rows.find(r=>r.operation.provider===provider)
        if(!row)return {kvOk:false,reason:'idle'}
        previousProvider=provider
        const built=buildD1WriteBatch(row.operation)
        if(!built.ok){persistPause(provider,row.operation.operationId);await notify('invalid_operation',provider);return {kvOk:false,reason:built.reason}}
        const outcome=await options.query.query(built.value)
        if(!outcome.ok){
          if(outcome.reason==='disabled')return {kvOk:false,reason:'disabled'}
          if(outcome.reason==='local'){localFailed=true;await notify('sender_control_failed');return {kvOk:false,reason:'local_commit_failed'}}
          if(outcome.reason==='auth'){auth=true;const s=options.control.read();if(!s.ok||!options.control.write({...s.value,authStopped:true}).ok)localFailed=true;await notify('d1_auth',provider,outcome.status);return {kvOk:false,reason:'auth_stopped'}}
          if(outcome.reason==='invalid'){persistPause(provider,row.operation.operationId);await notify('d1_invalid',provider,outcome.status);return {kvOk:false,reason:'provider_paused'}}
          const due=options.clock.now()+d1RetryDelay(row.attempts,options.random(),outcome.retryAfterMs)
          if(outcome.status===429){globalDue=due;await notify('d1_rate_limited',provider,429)}
          const updated=options.ledger.update(provider,data=>({ok:true,value:{...data,rows:data.rows.map(r=>r.operation.operationId===row.operation.operationId?{...r,attempts:r.attempts+1,nextAttemptAtMs:due}:r)}}))
          if(!updated.ok){localFailed=true;await notify('local_commit_failed',provider);return {kvOk:false,reason:updated.reason}}
          return {kvOk:false,reason:'retry',nextAttemptAtMs:due}
        }
        const env=JSON.parse(row.operation.envelopeJson)
        const receipt={operationId:row.operation.operationId,provider,writeSeq:row.operation.writeSeq,payloadSha256:row.operation.payloadSha256,createdAtMs:Date.parse(env.runAt)}
        const ack=options.ledger.update(provider,data=>acknowledgeOperation(data,receipt))
        if(!ack.ok){localFailed=true;await notify('local_commit_failed',provider);return {kvOk:false,reason:ack.reason}}
        const age=options.clock.now()-Date.parse(env.runAt)
        if(age>=0 && age<=env.intervalSec*1000 && row.alerts.length>0){try{await options.notifyAlerts(row.alerts)}catch{await notify('alert_delivery_failed',provider)}}
        return {kvOk:true,reason:'acknowledged'}
      }finally{busy=false}
    },
    /** Operator action only; caller must have quiesced all HTTP and confirmed receipt absence.
     * @param {Provider} provider @param {import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts} receipts */
    discard400(provider,receipts){
      const operationId=paused.get(provider)
      if(busy||!operationId)return {ok:false,reason:'not_quiesced_or_paused'}
      const current=options.ledger.read(provider)
      if(!current.ok)return current
      if(!current.value.rows.some(r=>r.operation.operationId===operationId)){return persistPause(provider,null)?current:{ok:false,reason:'local_commit_failed'}}
      const result=options.ledger.update(provider,data=>breakChain(data,{operationId,mode:'discard_400',receipts}))
      if(result.ok&&!persistPause(provider,null))return {ok:false,reason:'local_commit_failed'}
      return result
    },
    /** Operator action only; caller must have quiesced HTTP and confirmed receipt absence.
     * B1 breakChain resume_without_quarantine removes the quarantined FIFO head.
     * @param {Provider} provider @param {import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts} receipts */
    resumeWithoutQuarantine(provider,receipts){
      if(busy)return {ok:false,reason:'not_quiesced_or_paused'}
      const current=options.ledger.read(provider)
      if(!current.ok)return current
      const head=current.value.rows[0]
      if(!head||!head.quarantined)return {ok:false,reason:'not_quarantined'}
      return options.ledger.update(provider,data=>breakChain(data,{operationId:head.operation.operationId,mode:'resume_without_quarantine',receipts}))
    },
  }
}
