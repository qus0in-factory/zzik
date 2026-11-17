import { effectiveIntervalSec } from '../../domain/usage/interval-degrade.mjs'
/** Persistent due/start times; caller pumps current eligibility, never historical ticks. */
/** @param {{mode:'d1',providers:import('../../domain/usage/scheduler-types.ts').ScheduledProvider[],ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,clock:{now():number},canCollect:(provider:import('../../../shared/usage-contract.ts').UsageProvider)=>boolean,notice:import('../../domain/usage/d1-sender-types.ts').D1NoticePort}} options */
export function createProviderScheduler(options){
 let stopping=false,failed=false
 /** @type {Map<string,Promise<unknown>>} */const active=new Map()
 const limit=2
 const notify=async(reason='',provider='')=>{try{await options.notice.notify({reason,provider})}catch{}}
 return {
  stop(){stopping=true},
  pending:()=>[...active.values()],
  pump(){
   if(stopping||failed)return 0
   let started=0
   for(const provider of options.providers){
    if(active.size>=limit)break
    if(active.has(provider.id)||!options.canCollect(provider.id))continue
    const read=options.ledger.read(provider.id)
    if(!read.ok){failed=true;void notify('ledger_read_failed',provider.id);break}
    const state=read.value.state,now=options.clock.now()
    const interval=effectiveIntervalSec(provider,state,now)
    const dueInterval=state.nextDueIntervalSec??(provider.degrade && state.lastStartedAtMs!==null && state.nextDueMs===state.lastStartedAtMs+provider.degrade.intervalSec*1000?provider.degrade.intervalSec:interval)
    const due=(state.nextDueMs??0)-(provider.degrade?Math.max(0,dueInterval-interval)*1000:0)
    if(state.clockStopped || now<due || (state.lastStartedAtMs!==null&&now<state.lastStartedAtMs+interval*1000))continue
    let upstream=false
    const markStarted=()=>{
     if(stopping||failed||upstream||!options.canCollect(provider.id))return false
     const update=options.ledger.update(provider.id,data=>{
      const at=options.clock.now()
      if(data.state.lastStartedAtMs!==null&&at<data.state.lastStartedAtMs+effectiveIntervalSec(provider,data.state,at)*1000)return {ok:false,reason:'not_due'}
      return {ok:true,value:{...data,state:{...data.state,lastStartedAtMs:at,revision:data.state.revision+1}}}
     })
     if(!update.ok){failed=update.reason!=='not_due';return false}
     upstream=true;return true
    }
    // Reserve the provider before invoking user code (including synchronous callbacks).
    active.set(provider.id,Promise.resolve())
    let run
    try{run=provider.run({markStarted,isStopping:()=>stopping||failed})}catch{run=Promise.reject(new Error('provider_failed'))}
    const job=Promise.resolve(run).then(async outcome=>{
     const skew=outcome?.reason==='clock_skew'
     const update=options.ledger.update(provider.id,data=>{
      const count=skew?(data.state.clockSkewCount??0)+1:0
      const previous=data.state.previous===null?0:Date.parse(data.state.previous.runAt)
      const baseline=skew?Math.max(options.clock.now(),previous):upstream?(data.state.lastStartedAtMs??now):now
      return {ok:true,value:{...data,state:{...data.state,nextDueMs:baseline+effectiveIntervalSec(provider,data.state,options.clock.now())*1000,nextDueIntervalSec:effectiveIntervalSec(provider,data.state,options.clock.now()),clockSkewCount:count,clockStopped:count>=3,revision:data.state.revision+1}}}
     })
     if(!update.ok){failed=true;await notify('local_commit_failed',provider.id)}
     else if(provider.id==='claude' && provider.degrade && effectiveIntervalSec(provider,state,now)<effectiveIntervalSec(provider,update.value.state,options.clock.now()))await notify('claude_rate_limited_degraded',provider.id)
     else if(skew)await notify(update.value.state.clockStopped?'clock_skew_stopped':'clock_skew',provider.id)
     else if(outcome?.reason==='queue_limit')await notify('queue_limit',provider.id)
    }).catch(async()=>{
     // Provider-local failure: advance only this provider's due time. A local
     // ledger failure still stops the pump because the shared ledger is unusable.
     const update=options.ledger.update(provider.id,data=>{
      const baseline=data.state.lastStartedAtMs??options.clock.now()
      return {ok:true,value:{...data,state:{...data.state,nextDueMs:baseline+effectiveIntervalSec(provider,data.state,options.clock.now())*1000,nextDueIntervalSec:effectiveIntervalSec(provider,data.state,options.clock.now()),revision:data.state.revision+1}}}
     })
     if(!update.ok){failed=true;await notify('local_commit_failed',provider.id)}
     else await notify('provider_execution_failed',provider.id)
    }).finally(()=>{active.delete(provider.id)})
    active.set(provider.id,job);started++
   }
   return started
  },
 }
}
