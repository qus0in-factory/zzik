import { createQuiescer } from './quiesce.mjs'
/** @param {{periodMs:number,timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,run(shouldStop:()=>boolean):Promise<unknown>,close():Promise<void>,onError():void}} options */
export function createResidentCollector(options){
 let stopping=false
 /** @type {Promise<unknown>|null} */let active=null
 /** @type {()=>void} */let cancel=()=>{}
 const tick=()=>{
  if(stopping)return
  if(active!==null){try{process.stderr.write('[zzik-usage-collector] 이전 주기가 아직 진행 중이라 이번 주기를 건너뛴다\n')}catch{};return}
  active=Promise.resolve().then(()=>options.run(()=>stopping)).catch(()=>{try{options.onError()}catch{}}).finally(()=>{active=null})
 }
 const schedule=()=>{if(!stopping)cancel=options.timer.schedule(options.periodMs,()=>{tick();schedule()})}
 const quiesce=createQuiescer({timer:options.timer,stop:()=>{stopping=true;cancel()},pending:()=>active===null?[]:[active],close:options.close})
 return {tick,runOnce(){tick();return active??Promise.resolve()},start(){tick();schedule()},shutdown:()=>quiesce.shutdown()}
}
