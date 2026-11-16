import { runOnce, emptyCollectorState } from './run-once.mjs'
import { acceptObservation, queueHealth } from '../../domain/usage/d1-ledger.mjs'
/** @typedef {import('../../domain/usage/ports.mjs').CollectorState} Legacy */
/** @param {{provider:import('../../../shared/usage-contract.ts').UsageProvider,ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,clock:{now():number},intervalSec:number,operationId:()=>string,context:{markStarted():boolean,isStopping():boolean},ports:import('../../domain/usage/ports.mjs').CollectorPorts,runOptions?:object,collectorVersion?:string}} options */
export async function runD1Provider(options){
 const read=options.ledger.read(options.provider),stats=options.ledger.stats()
 if(!read.ok||!stats.ok)return {reason:'ledger_read_failed'}
 if(options.context.isStopping())return {reason:'stopping'}
 if(!queueHealth(stats.value,options.clock.now()).collect)return {reason:'queue_limit'}
 const baseline=read.value.state
 if(baseline.previous!==null&&options.clock.now()<Date.parse(baseline.previous.runAt))return {reason:'clock_skew'}
 /** @type {import('../../../shared/usage-contract.ts').UsageEnvelope|null} */let envelope=null
 /** @type {Legacy|null} */let captured=null
 /** @type {import('../../domain/usage/ports.mjs').LogEntry[]} */const logs=[]
 let cancelled=false
 const result=await runOnce({...options.ports,clock:options.clock,
  state:{read:async()=>({...emptyCollectorState(),...baseline,provider:options.provider}),write:async state=>{captured=/** @type {Legacy} */(state)}},
  // Staging sink only. Neither this success nor runOnce's buffered log is a remote ack.
  store:{write:async text=>{envelope=JSON.parse(text);return {ok:true}}},
  logger:{write:async entry=>{logs.push(entry)}},
  usage:{fetchUsage:async(token,opts)=>{
   if(!options.context.markStarted()){cancelled=true;return {ok:false,kind:'network_error',httpStatus:null,retryAfterSec:null}}
   return options.ports.usage.fetchUsage(token,opts)
  }},
 },{...options.runOptions,provider:options.provider,intervalSec:options.intervalSec,collectorVersion:options.collectorVersion})
 if(cancelled)return {reason:'stopping'}
 // Async injected callbacks assign these staged values before runOnce resolves.
 const staged=/** @type {Legacy|null} */(captured),observation=/** @type {import('../../../shared/usage-contract.ts').UsageEnvelope|null} */(envelope)
 if(staged===null||observation===null||result.exitCode!==0)return {reason:'staging_failed'}
 const accepted=options.ledger.update(options.provider,data=>{
  const transition=acceptObservation(data,{envelope:observation,operationId:options.operationId(),nowMs:options.clock.now(),lastStartedAtMs:data.state.lastStartedAtMs??options.clock.now(),nextDueMs:data.state.nextDueMs??options.clock.now(),alerts:result.alerts??[],gate:staged.gate,alertBaseline:staged.alerts})
  // A gate-only tick must not pretend to have started an upstream call.
  if(transition.ok)transition.value.state.lastStartedAtMs=data.state.lastStartedAtMs
  return transition
 })
 for(const log of logs){try{await options.ports.logger.write({...log,kvOk:false,kvReason:accepted.ok?'queued':accepted.reason,stateOk:accepted.ok})}catch{}}
 return {reason:accepted.ok?'queued':accepted.reason}
}
