/** Opt-in maintenance only. All queries must share the sender's D1QueryPort lane. */
import { USAGE_PROVIDERS } from '../../domain/usage/providers.mjs'
/** @param {{mode:string,dryRun:boolean,control:import('../../domain/usage/d1-sender-types.ts').D1ControlPort,query:import('../../domain/usage/d1-sender-types.ts').D1QueryPort,clock:import('../../domain/usage/d1-sender-types.ts').D1Clock,noticeState:import('../../domain/usage/d1-sender-types.ts').MaintenanceNoticeState,notice:import('../../domain/usage/d1-sender-types.ts').D1NoticePort}} options */
export function createD1Maintenance(options) {
  let lastHealth=-Infinity,healthBusy=false,pruneBusy=false
  const enabled=()=>options.mode==='d1'&&!options.dryRun
  /** @param {string} reason */
  const notify=async reason=>{
    const claimed=options.noticeState.claim(reason,options.clock.now())
    if(!claimed.ok||!claimed.value)return
    try{await options.notice.notify({reason})}catch{}
  }
  return {
    async checkHealth(){
      if(!enabled())return {ok:false,reason:'disabled'}
      const control=options.control.read()
      if(!control.ok){await notify('sender_control_failed');return {ok:false,reason:control.reason}}
      if(control.value.lastHealthCheckAtMs!==null)lastHealth=Math.max(lastHealth,control.value.lastHealthCheckAtMs)
      if(healthBusy||options.clock.now()-lastHealth<86400000)return {ok:false,reason:'not_due'}
      healthBusy=true
      try {
        const r=await options.query.query([
          {sql:'SELECT ran_at_ms FROM usage_export_log WHERE ok=1 ORDER BY ran_at_ms DESC LIMIT 1',params:[]},
          {sql:'SELECT provider,stalled_at_ms FROM usage_bucket_checkpoint WHERE stalled_at_ms IS NOT NULL',params:[]},
        ])
        if(!r.ok&&r.reason==='disabled'){
          const current=options.control.read()
          if(current.ok&&current.value.lastHealthCheckAtMs===lastHealth)options.control.write({...current.value,lastHealthCheckAtMs:control.value.lastHealthCheckAtMs})
          lastHealth=control.value.lastHealthCheckAtMs??-Infinity
          return {ok:false,reason:'disabled'}
        }
        if(!r.ok){await notify(r.reason==='auth'?'d1_auth':'d1_export_read_failed');return {ok:false,reason:r.reason}}
        const latest=/** @type {{ran_at_ms?:unknown}[]|undefined} */(r.value[0]?.results)
        const stalls=/** @type {{stalled_at_ms?:unknown}[]|undefined} */(r.value[1]?.results)
        if(!Array.isArray(latest)||!Array.isArray(stalls)){await notify('d1_export_read_failed');return {ok:false,reason:'invalid_health_result'}}
        const checkedAt=options.clock.now()
        // Re-read just before writing: a REST call on the same lane may have advanced
        // nextRequestAtMs (or another control field) while the health query was in flight.
        const current=options.control.read()
        if(!current.ok){await notify('sender_control_failed');return {ok:false,reason:current.reason}}
        const saved=options.control.write({...current.value,lastHealthCheckAtMs:checkedAt})
        if(!saved.ok){await notify('sender_control_failed');return {ok:false,reason:saved.reason}}
        lastHealth=checkedAt
        const at=latest[0]?.ran_at_ms
        if(typeof at!=='number'||!Number.isSafeInteger(at)||checkedAt-at>36*3600000)await notify('d1_export_stale')
        if(stalls.some(s=>s.stalled_at_ms!==null&&s.stalled_at_ms!==undefined))await notify('d1_checkpoint_stalled')
        return {ok:true}
      }finally{healthBusy=false}
    },
    /** Does not mutate B1 metadata; caller persists returned lastPruneAt only on success.
     * @param {string|null} lastPruneAt @param {number} retentionDays */
    async prune(lastPruneAt,retentionDays){
      if(!enabled())return {ok:false,reason:'disabled',lastPruneAt}
      if(pruneBusy)return {ok:false,reason:'busy',lastPruneAt}
      const previous=lastPruneAt===null?NaN:Date.parse(lastPruneAt),now=options.clock.now()
      if(!Number.isFinite(previous)){await notify('prune_time_unknown');return {ok:false,reason:'prune_time_unknown',lastPruneAt}}
      if(now-previous<86400000)return {ok:false,reason:'not_due',lastPruneAt}
      if(!Number.isSafeInteger(retentionDays)||retentionDays<1)return {ok:false,reason:'invalid_retention',lastPruneAt}
      pruneBusy=true
      try {
        for(const provider of USAGE_PROVIDERS){
          for(const [table,key,time,days] of /** @type {[string,string,string,number][]} */([
            ['usage_event','id','run_at',retentionDays],
            ['usage_bucket_boundary','rowid','run_at_ms',retentionDays],
            ['usage_write_receipt','operation_id','created_at_ms',35],
          ])){
            let finished=false
            for(let batch=0;batch<100;batch++){
              const r=await options.query.query([{sql:`DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE provider=? AND ${time}<? LIMIT 500)`,params:[provider,now-days*86400000]}])
              if(!r.ok){if(r.reason!=='disabled')await notify(r.reason==='auth'?'d1_auth':'d1_prune_failed');return {ok:false,reason:r.reason,lastPruneAt}}
              const meta=/** @type {{changes?:unknown}|undefined} */(r.value[0]?.meta),changes=meta?.changes
              if(typeof changes!=='number'||!Number.isSafeInteger(changes)||changes<0){await notify('d1_prune_failed');return {ok:false,reason:'invalid_prune_result',lastPruneAt}}
              if(changes===0){finished=true;break}
            }
            if(!finished){await notify('d1_prune_incomplete');return {ok:false,reason:'incomplete',lastPruneAt}}
          }
        }
        return {ok:true,lastPruneAt:new Date(now).toISOString()}
      }finally{pruneBusy=false}
    },
  }
}
