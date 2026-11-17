/** Serialize agy processes and give queued quota calls priority.
 * @param {(kind:'quota'|'models')=>Promise<string|null>} run */
export function createAgyLane(run){
 /** @type {Array<{kind:'quota'|'models',resolve:(result:string|null)=>void}>} */const pending=[]
 let busy=false
 const pump=()=>{
  if(busy||!pending.length)return
  busy=true
  const quota=pending.findIndex(item=>item.kind==='quota'),item=pending.splice(quota<0?0:quota,1)[0]
  Promise.resolve().then(()=>run(item.kind)).catch(()=>null).then(value=>item.resolve(value)).finally(()=>{busy=false;pump()})
 }
 /** @param {'quota'|'models'} kind */
 const enqueue=kind=>new Promise(/** @param {(value:string|null)=>void} resolve */resolve=>{pending.push({kind,resolve});pump()})
 return {quota:()=>enqueue('quota'),models:()=>enqueue('models'),cancelModels(){for(let i=pending.length-1;i>=0;i--)if(pending[i].kind==='models')pending.splice(i,1)[0].resolve(null)}}
}
