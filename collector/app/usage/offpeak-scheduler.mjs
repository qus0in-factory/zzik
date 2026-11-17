import {nextOffpeakEvents} from '../../domain/usage/offpeak-notification.mjs'
/** @typedef {import('../../domain/usage/offpeak-notification.mjs').OffpeakEvent} Event */
/** @typedef {import('../../domain/usage/offpeak-notification.mjs').OffpeakNoticeState} OffpeakNoticeState */
/** One next-event timeout, not polling. Claim before sending: at-most-once across crashes.
 * @param {{schedule:import('../../domain/usage/offpeak-notification.mjs').Schedule,clock:{now():number},timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,state:{read():Promise<unknown>,write(state:OffpeakNoticeState):Promise<void>},send:(events:Event[])=>Promise<unknown>,log?:(reason:string)=>void}} ports */
export function createOffpeakScheduler(ports){
 let stopped=false
 /** @type {Record<string,number>} */let keys={}
 /** @type {()=>void} */let cancel=()=>{}
 /** @type {Promise<void>|null} */let starting=null
 /** @type {Promise<void>|null} */let inFlight=null
 /** @type {Promise<void>|null} */let closing=null
 const log=(/** @type {string} */reason)=>{try{ports.log?.(reason)}catch{}}
 const fail=()=>{stopped=true;cancel();log('state_failed')}
 const arm=()=>{
  if(stopped)return
  const now=ports.clock.now(),events=nextOffpeakEvents(ports.schedule,now-120000,Object.keys(keys))
  if(!events.length)return
  cancel=ports.timer.schedule(Math.max(0,events[0].atMs-now),()=>{
   if(stopped||inFlight!==null)return
   inFlight=deliver(events).finally(()=>{inFlight=null;if(!stopped)arm()})
  })
 }
 /** @param {Event[]} batch */
 const deliver=async batch=>{
  const now=ports.clock.now(),events=batch.filter(e=>!Object.hasOwn(keys,e.key))
  if(stopped||!events.length||now<events[0].atMs||now-events[0].atMs>120000)return
  const next=Object.fromEntries(Object.entries(keys).filter(([,at])=>at>=now-14*86400000))
  for(const event of events)next[event.key]=event.atMs
  try{await ports.state.write({v:1,keys:next})}catch{fail();return}
  keys=next
  if(stopped)return
  try{
   const sent=await ports.send(events)
   if(sent!==null&&typeof sent==='object'&&'status' in sent&&sent.status==='failed')log('send_failed')
  }catch{log('send_failed')}
 }
 return {
  start(){
   if(starting!==null)return starting
   if(stopped)return Promise.resolve()
   starting=(async()=>{
    try{
     const saved=/** @type {{v?:unknown,keys?:unknown}|null} */(await ports.state.read())
     if(stopped)return
     if(saved!==null){
      if(typeof saved!=='object'||saved.v!==1||saved.keys===null||typeof saved.keys!=='object'||Array.isArray(saved.keys)||!Object.values(saved.keys).every(at=>Number.isSafeInteger(at)&&at>=0))throw Error('state')
      keys=/** @type {Record<string,number>} */(saved.keys)
     }
     arm()
    }catch{fail()}
   })()
   return starting
  },
  shutdown(){
   if(closing!==null)return closing
   stopped=true;cancel()
   closing=Promise.allSettled([starting,inFlight].filter(p=>p!==null)).then(()=>{})
   return closing
  },
 }
}
