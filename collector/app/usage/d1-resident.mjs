import { createProviderScheduler } from './provider-scheduler.mjs'
import { createD1Sender } from './d1-sender.mjs'
import { createD1Maintenance } from './d1-maintenance.mjs'
import { runLedgerMaintenance } from './run-ledger-maintenance.mjs'
import { runD1Provider } from './run-d1-provider.mjs'
import { createQuiescer } from './quiesce.mjs'
/** @param {{ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,control:import('../../domain/usage/d1-sender-types.ts').D1ControlPort,query:import('../../domain/usage/d1-sender-types.ts').D1QueryPort,timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,clock:{now():number},random:()=>number,operationId:()=>string,notice:import('../../domain/usage/d1-sender-types.ts').D1NoticePort,notifyAlerts:(alerts:unknown[])=>Promise<void>,providers:Array<{id:string,ports:import('../../domain/usage/ports.mjs').CollectorPorts,runOptions?:object}>,intervals:Record<string,number>,retentionDays:number,collectorVersion:string,once?:boolean,shutdownPending?:()=>Promise<unknown>[]}} options */
export function createD1Resident(options){
 let stopping=false,started=false
 /** @type {()=>void} */let cancel=()=>{}
 /** @type {Promise<unknown>|null} */let sending=null
 /** @type {Promise<unknown>|null} */let maintaining=null
 const completed=new Set()
 const sender=createD1Sender({...options,mode:'d1',dryRun:false})
 const maintenance=createD1Maintenance({...options,mode:'d1',dryRun:false,noticeState:{claim:(reason,atMs)=>options.ledger.claimMaintenanceNotice(reason,atMs)}})
 const scheduler=createProviderScheduler({...options,mode:'d1',canCollect:provider=>sender.canCollect(provider)&&(!options.once||!completed.has(provider)),providers:options.providers.map(bundle=>({
  id:/** @type {import('../../../shared/usage-contract.ts').UsageProvider} */(bundle.id),intervalSec:options.intervals[bundle.id],degrade:bundle.id==='claude'?{intervalSec:900}:undefined,
  run:async context=>{const result=await runD1Provider({...options,provider:/** @type {import('../../../shared/usage-contract.ts').UsageProvider} */(bundle.id),intervalSec:options.intervals[bundle.id],degrade:bundle.id==='claude'?{intervalSec:900}:undefined,ports:bundle.ports,runOptions:bundle.runOptions,context});completed.add(bundle.id);return result},
 }))})
 const pump=()=>{
  if(stopping)return
  const quarantined=options.ledger.quarantine(options.clock.now())
  if(!quarantined.ok){scheduler.stop();return}
  if(quarantined.value>0)void options.notice.notify({reason:'queue_quarantined'}).catch(()=>{})
  scheduler.pump()
  if(sending===null)sending=sender.tick().catch(()=>{}).finally(()=>{sending=null})
  if(maintaining===null)maintaining=runLedgerMaintenance({ledger:options.ledger,maintenance,clock:options.clock,notice:options.notice,retentionDays:options.retentionDays}).catch(()=>{}).finally(()=>{maintaining=null})
 }
 const quiesce=createQuiescer({timer:options.timer,stop:()=>{stopping=true;cancel();scheduler.stop()},pending:()=>[...scheduler.pending(),...(sending?[sending]:[]),...(maintaining?[maintaining]:[]),...(options.shutdownPending?.()??[])],close:async()=>{options.ledger.close()}})
 const loop=()=>{if(!stopping){pump();cancel=options.timer.schedule(250,loop)}}
 return {canRequest:()=>!stopping,start:()=>{started=true;loop()},pump,
  /** Operator-only pre-start action. The process lock and receipt probe belong to main.
   * @param {import('../../../shared/usage-contract.ts').UsageProvider} provider
   * @param {import('../../domain/usage/d1-ledger-types.ts').ReceiptFacts} receipts */
  resumeWithoutQuarantine(provider,receipts){
   if(started||stopping||sending!==null||maintaining!==null||scheduler.pending().length>0)return {ok:false,reason:'not_quiesced'}
   return sender.resumeWithoutQuarantine(provider,receipts)
  },
  onceDone:()=>scheduler.pending().length===0&&sending===null&&options.providers.every(bundle=>{
   const provider=/** @type {import('../../../shared/usage-contract.ts').UsageProvider} */(bundle.id)
   if(completed.has(provider)||!sender.canCollect(provider))return true
   const read=options.ledger.read(provider);return !read.ok||read.value.state.clockStopped===true||(read.value.state.nextDueMs??0)>options.clock.now()
  })&&(()=>{const p=options.ledger.pending(options.clock.now());return !p.ok||p.value.every(row=>!sender.canCollect(row.operation.provider))})(),
  exitCode:()=>{const stats=options.ledger.stats();return stats.ok&&stats.value.count===0?0:3},
  shutdown:()=>quiesce.shutdown()}
}
