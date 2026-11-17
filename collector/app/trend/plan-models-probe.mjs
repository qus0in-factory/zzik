import {parseAgyModels,parseClaudeModels,planStatement} from '../../domain/trend/plan-models.mjs'
const PERIOD=6*60*60*1000
/** @param {{clock:{now():number},timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,state:{read():Promise<unknown>,write(value:Record<string,number>):Promise<void>},runAgy:()=>Promise<string|null>,readClaude:()=>string|null,query:{query(statements:import('../../../shared/d1-contract.ts').D1SqlStatement[]):Promise<{ok:boolean}>},providers?:string[],claimNotice:(provider:string,at:number)=>boolean,notice:(provider:string)=>Promise<void>}} ports */
export function createPlanModelsProbe(ports){
 const providers=(ports.providers??['antigravity','claude']).filter(p=>p==='antigravity'||p==='claude')
 let stopped=false
 /** @type {()=>void} */let cancel=()=>{}
 /** @type {Promise<void>|null} */let active=null
 /** @type {Record<string,number>} */let saved={}
 /** @type {Record<string,number>} */let due={}
 const fail=async(/** @type {string} */provider)=>{try{if(ports.claimNotice(provider,ports.clock.now()))await ports.notice(provider)}catch{}}
 const run=async()=>{
  for(const provider of providers){
   if(stopped)return
   const now=ports.clock.now()
   if((due[provider]??0)>now)continue
   due[provider]=now+PERIOD
   try{
    const parsed=provider==='antigravity'?parseAgyModels(await ports.runAgy()):parseClaudeModels(ports.readClaude())
    if(stopped)return
    if(!parsed.ok){await fail(provider);continue}
    const result=await ports.query.query([planStatement(provider==='claude'?'claude-max':provider,provider==='claude'?'usage-keys':'agy-cli',parsed.value,now)])
    if(!result.ok){if(!stopped)await fail(provider);continue}
    saved={...saved,[provider]:now};await ports.state.write(saved)
   }catch{if(!stopped)await fail(provider)}
  }
 }
 const arm=()=>{if(!stopped&&Object.keys(due).length)cancel=ports.timer.schedule(Math.max(0,Math.min(...Object.values(due))-ports.clock.now()),()=>{if(stopped)return;active=run().finally(()=>{active=null;arm()})})}
 return {
  start(){
   active=(async()=>{
   try{const state=await ports.state.read();if(state&&typeof state==='object'&&!Array.isArray(state))saved=/** @type {Record<string,number>} */(state)}catch{for(const provider of providers)await fail(provider);return}
   if(stopped)return
   const now=ports.clock.now()
   for(const provider of providers)due[provider]=Number.isFinite(saved[provider])&&saved[provider]<=now?saved[provider]+PERIOD:now
   await run()
   })().finally(()=>{active=null;arm()})
   return active
  },
  async shutdown(){stopped=true;cancel();if(active)await active},
 }
}
