import {createQuiescer} from './quiesce.mjs'
/** @param {{once:boolean,dryRun:boolean,resume:boolean,enabled:boolean,webhook:boolean,create:()=>{start():Promise<void>,shutdown():Promise<void>}}} options */
export function createOffpeakRuntime(options){
 if(options.once||options.dryRun||options.resume||!options.enabled||!options.webhook)return null
 const notifier=options.create()
 /** @type {Promise<{timedOut:boolean}>|null} */let closing=null
 return {
  start:()=>notifier.start(),
  stop:()=>notifier.shutdown(),
  /** @param {{shutdown():Promise<{timedOut:boolean}>}} collector @param {import('../../domain/usage/scheduler-types.ts').CollectorTimer} timer */
  shutdownWith(collector,timer){
   if(closing!==null)return closing
   /** @type {Promise<{timedOut:boolean}>|null} */let collectorResult=null
   const quiescer=createQuiescer({timer,stop:()=>{},pending:()=>[notifier.shutdown(),collectorResult=collector.shutdown()],close:async()=>{}})
   closing=quiescer.shutdown().then(async result=>result.timedOut?result:(await /** @type {Promise<{timedOut:boolean}>} */(collectorResult)))
   return closing
  },
 }
}
