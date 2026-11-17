/** Serialize agy processes and give queued quota calls priority.
 * @param {(kind:'quota'|'models',signal:AbortSignal)=>Promise<string|null>} run */
export function createAgyLane(run){
 /** @type {Array<{kind:'quota'|'models',resolve:(result:string|null)=>void}>} */const pending=[]
 let busy=false
 /** @type {AbortController|null} */let modelController=null
 const pump=()=>{
  if(busy||!pending.length)return
  busy=true
  const quota=pending.findIndex(item=>item.kind==='quota'),item=pending.splice(quota<0?0:quota,1)[0]
  const controller=new AbortController();if(item.kind==='models')modelController=controller
  Promise.resolve().then(()=>run(item.kind,controller.signal)).catch(()=>null).then(value=>item.resolve(value)).finally(()=>{modelController=null;busy=false;pump()})
 }
 /** @param {'quota'|'models'} kind */
 const enqueue=kind=>new Promise(/** @param {(value:string|null)=>void} resolve */resolve=>{pending.push({kind,resolve});if(kind==='quota')modelController?.abort();pump()})
 return {quota:()=>enqueue('quota'),models:()=>enqueue('models'),cancelModels(){modelController?.abort();for(let i=pending.length-1;i>=0;i--)if(pending[i].kind==='models')pending.splice(i,1)[0].resolve(null)}}
}

/** @param {'quota'|'models'} kind @param {string} path @param {boolean} enabled */
export function agyCliOptions(kind,path,enabled){return kind==='models'?{path,enabled,args:['models'],timeoutMs:5000}:{path,enabled,args:['-p','/quota']}}
