/** Completes B2's returned checkpoint contract without inventing a successful prune. */
/** @param {{ledger:import('../../domain/usage/d1-ledger-types.ts').LedgerPort,maintenance:{checkHealth():Promise<unknown>,prune(last:string|null,days:number):Promise<{ok:boolean,lastPruneAt?:string|null}>},clock:{now():number},retentionDays:number,notice:import('../../domain/usage/d1-sender-types.ts').D1NoticePort}} options */
export async function runLedgerMaintenance(options){
 await options.maintenance.checkHealth()
 const state=options.ledger.pruneState()
 if(!state.ok)return state
 const now=options.clock.now(),s=state.value
 const lastMs=s.lastPruneAt===null?NaN:Date.parse(s.lastPruneAt)
 const invalidLast=!Number.isFinite(lastMs)
 if(s.skipFirstPrune || (invalidLast && s.skippedAtMs===undefined)){
  const claimed=options.ledger.claimMaintenanceNotice('prune_time_unknown',now)
  if(claimed.ok&&claimed.value)try{await options.notice.notify({reason:'prune_time_unknown'})}catch{}
  return options.ledger.checkpointPrune({kind:'skipped',atMs:now})
 }
 const baseline=invalidLast?(s.skippedAtMs===undefined?null:new Date(s.skippedAtMs).toISOString()):s.lastPruneAt
 if(baseline===null||now-Date.parse(baseline)<86400000)return {ok:true,value:undefined}
 const result=await options.maintenance.prune(baseline,options.retentionDays)
 if(!result.ok)return {ok:false,reason:'prune_failed'}
 const atMs=typeof result.lastPruneAt==='string'?Date.parse(result.lastPruneAt):NaN
 if(!Number.isFinite(atMs))return {ok:false,reason:'invalid_prune_checkpoint'}
 return options.ledger.checkpointPrune({kind:'completed',atMs})
}
