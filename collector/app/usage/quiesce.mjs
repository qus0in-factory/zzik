/** Both modes wait for current work only. No outbox-wide catch-up during shutdown. */
/** @param {{stop():void,pending():Promise<unknown>[],close():Promise<void>,timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer}} options */
export function createQuiescer(options){
 /** @type {Promise<{timedOut:boolean}>|null} */let result=null
 return {shutdown(){
  if(result!==null)return result
  options.stop()
  result=new Promise(resolve=>{
   let done=false
   const cancel=options.timer.schedule(30000,()=>{if(!done){done=true;resolve({timedOut:true})}})
   void Promise.allSettled(options.pending()).then(async()=>{
    if(done)return
    try{await options.close()}catch{/* shutdown must still settle */}
    if(!done){done=true;cancel();resolve({timedOut:false})}
   })
  })
  return result
 }}
}
