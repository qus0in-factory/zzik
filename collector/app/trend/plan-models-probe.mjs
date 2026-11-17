import {parseAgyModels,parseClaudeModels,parseGrokModels,planStatement} from '../../domain/trend/plan-models.mjs'
const PERIOD=6*60*60*1000
/** @param {{clock:{now():number},timer:import('../../domain/usage/scheduler-types.ts').CollectorTimer,state:{read():Promise<unknown>,write(value:Record<string,number>):Promise<void>},retryState?:{read():Promise<unknown>,write(value:Record<string,number>):Promise<void>},runAgy:()=>Promise<string|null>,readClaude:()=>string|null,readGrok?:()=>Promise<string|null>,query:{query(statements:import('../../../shared/d1-contract.ts').D1SqlStatement[]):Promise<{ok:boolean}>},providers?:string[],cancelAgy?:()=>void,claimNotice:(provider:string,at:number)=>boolean,notice:(provider:string)=>Promise<void>}} ports */
export function createPlanModelsProbe(ports){
 const providers=(ports.providers??['antigravity','claude']).filter(p=>p==='antigravity'||p==='claude'||p==='grok')
 const retryState=ports.retryState??{read:async()=>null,write:async()=>{}}
 let stopped=false,loaded=false
 /** @type {()=>void} */let cancel=()=>{}
 /** @type {Promise<void>|null} */let active=null
 /** @type {Record<string,number>} */let saved={}
 /** @type {Record<string,number>} */let due={}
 /** @type {Record<string,number>} */let attempts={}
 const fail=async(/** @type {string} */provider)=>{try{if(ports.claimNotice(provider,ports.clock.now()))await ports.notice(provider)}catch{}}
 /** @param {unknown} state */
 const valid=state=>state===null||(typeof state==='object'&&!Array.isArray(state)&&Object.values(state).every(v=>Number.isSafeInteger(v)&&v>=0))
 const run=async()=>{
  if(!loaded){
   try{
    const successes=await ports.state.read(),retries=await retryState.read()
    if(!valid(successes)||!valid(retries))throw Error('invalid_state')
    saved=/** @type {Record<string,number>} */(successes??{});attempts=/** @type {Record<string,number>} */(retries??{})
    for(const provider of providers)due[provider]=Math.max(saved[provider]??0,attempts[provider]??0)+(saved[provider]!==undefined||attempts[provider]!==undefined?PERIOD:0)
    loaded=true
   }catch{for(const provider of providers){due[provider]=ports.clock.now()+PERIOD;await fail(provider)}return}
  }
  for(const provider of providers){
   if(stopped)return
   const now=ports.clock.now()
   if((due[provider]??0)>now)continue
   due[provider]=now+PERIOD
   try{
    // Persist the attempt before any external call, including across restarts.
    attempts={...attempts,[provider]:now};await retryState.write(attempts)
    if(stopped)return
    const parsed=provider==='antigravity'?parseAgyModels(await ports.runAgy()):provider==='claude'?parseClaudeModels(ports.readClaude()):parseGrokModels(await ports.readGrok?.()??null)
    if(stopped)return
    if(!parsed.ok){await fail(provider);continue}
    const result=await ports.query.query([planStatement(provider==='claude'?'claude-max':provider,provider==='claude'?'usage-keys':provider==='grok'?'grok-build-models':'agy-cli',parsed.value,now)])
    if(!result.ok){if(!stopped)await fail(provider);continue}
    saved={...saved,[provider]:now};await ports.state.write(saved)
   }catch{if(!stopped)await fail(provider)}
  }
 }
 const arm=()=>{if(!stopped&&Object.keys(due).length)cancel=ports.timer.schedule(Math.max(0,Math.min(...Object.values(due))-ports.clock.now()),()=>{if(stopped)return;active=run().finally(()=>{active=null;arm()})})}
 return {
  start(){active=run().finally(()=>{active=null;arm()});return active},
  async shutdown(){stopped=true;cancel();ports.cancelAgy?.();if(active)await active},
 }
}
