const DAY_MS=86400000
/** @param {{intervalSec:number,degrade?:{intervalSec:number}}} policy @param {{rateLimitedAtMs?:unknown}} state @param {number} nowMs */
export function effectiveIntervalSec(policy,state,nowMs){
 if(!policy.degrade || !Array.isArray(state.rateLimitedAtMs) || !Number.isFinite(nowMs))return policy.intervalSec
 const recent=state.rateLimitedAtMs.filter(at=>Number.isSafeInteger(at)&&at>=0&&at<=nowMs&&nowMs-at<=7*DAY_MS)
 if(recent.length===0)return policy.intervalSec
 const last=Math.max(...recent),hold=Math.min(DAY_MS*2**Math.min(recent.length-1,3),7*DAY_MS)
 return nowMs-last<=hold?Math.max(policy.intervalSec,policy.degrade.intervalSec):policy.intervalSec
}
/** @param {unknown} history @param {number} nowMs */
export function appendRateLimit(history,nowMs){
 const recent=Array.isArray(history)?history.filter(at=>Number.isSafeInteger(at)&&at>=0&&at<=nowMs&&nowMs-at<=7*DAY_MS):[]
 return [...recent,nowMs].sort((a,b)=>a-b).slice(-10)
}
