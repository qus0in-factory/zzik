import {mergedOffpeakIntervals} from '../../../shared/offpeak.ts'
/** @typedef {import('../../../shared/offpeak.ts').OffpeakSchedule} Schedule */
/** @typedef {{v:1,keys:Record<string,number>}} OffpeakNoticeState */
/** @typedef {{key:string,provider:import('../../../shared/usage-contract.ts').UsageProvider,kind:'started'|'ending',atMs:number,startMs:number,endMs:number,effect?:import('../../../shared/offpeak.ts').OffpeakEffect}} OffpeakEvent */
const DAY=86400000,MINUTE=60000
/** Next simultaneous batch after the inclusive lower bound; weekly windows merge first.
 * @param {Schedule} schedule @param {number} fromMs @param {readonly string[]} [excluded]
 * @returns {OffpeakEvent[]} */
export function nextOffpeakEvents(schedule,fromMs,excluded=[]){
 if(!Number.isFinite(fromMs))return []
 const midnight=Math.floor(fromMs/DAY)*DAY,seen=new Set(excluded)
 /** @type {OffpeakEvent[]} */const events=[]
 for(const [name,rule] of Object.entries(schedule)){
  const provider=/** @type {OffpeakEvent['provider']} */(name)
  for(const interval of mergedOffpeakIntervals(rule,new Date(fromMs),8,16)){
   // A union touching either expansion edge has no proven finite boundary.
   if(interval.start<=midnight-8*DAY||interval.end>=midnight+17*DAY||interval.end-interval.start<=20*MINUTE)continue
   for(const kind of /** @type {const} */(['started','ending'])){
    const atMs=kind==='started'?interval.start+10*MINUTE:interval.end-10*MINUTE
    const key=`${provider}:${kind}:${interval.start}:${interval.end}`
    if(atMs>=fromMs&&!seen.has(key))events.push({key,provider,kind,atMs,startMs:interval.start,endMs:interval.end,effect:rule?.effect})
   }
  }
 }
 events.sort((a,b)=>a.atMs-b.atMs||a.provider.localeCompare(b.provider)||a.kind.localeCompare(b.kind))
 return events.length?events.filter(e=>e.atMs===events[0].atMs):[]
}
/** @param {OffpeakEvent} event */
function kstEnd(event){
 const date=new Date(event.endMs+9*3600000)
 const clock=`${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}(KST)`
 return event.endMs-event.startMs>DAY?`${date.getUTCMonth()+1}/${date.getUTCDate()}(${ '일월화수목금토'[date.getUTCDay()]}) ${clock}`:clock
}
/** Public schedule data only; same dashboard and bounded content convention as usage alerts.
 * @param {readonly OffpeakEvent[]} events */
export function formatOffpeakMessage(events){
 const names=/** @type {Record<string,string>} */({opencode:'OpenCode Go',ollama:'Ollama'})
 const lines=events.map(e=>{
  const prefix=e.kind==='started'?'off-peak 시작':'off-peak 10분 후 종료'
  const until=e.kind==='started'?`${kstEnd(e)}까지`:`${kstEnd(e)}부터 peak`
  const effect=e.effect?` · ${e.effect.target.replace(/[\r\n]/g,' ').slice(0,80)} ${e.effect.discountPercent}% 할인`:''
  return `${prefix} · ${names[e.provider]??e.provider} · ${until}${effect}`
 })
 return [`off-peak 알림 (${events.length}건)`,...lines,'https://zzik.qus0in.dev'].join('\n').slice(0,1900)
}
