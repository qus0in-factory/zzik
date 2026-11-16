import {fakeD1Control} from './d1-control'
import type { LedgerPort,LedgerData } from '../../collector/domain/usage/d1-ledger-types'
import type { UsageProvider } from '../../shared/usage-contract'
import type { D1QueryResult } from '../../collector/domain/usage/d1-sender-types'
import type {Observation} from '../../collector/domain/usage/d1-ledger-types'
import type {D1Result} from '../../shared/d1-contract'
import {d1Envelope,D1_NOW,successValue} from './d1-contract'
export function senderFixture(domain:{initialLedgerState():LedgerData;acceptObservation(data:LedgerData,input:Observation):D1Result<LedgerData>}){
 const {initialLedgerState,acceptObservation}=domain
 let now=Date.parse(D1_NOW),failCommit=false
 const data=new Map<UsageProvider,LedgerData>()
 const noticeTimes=new Map<string,number>()
 const calls:unknown[]=[];const notices:unknown[]=[];const alerts:unknown[][]=[]
 const responses:D1QueryResult[]=[]
 const ledger:LedgerPort={read:p=>({ok:true,value:structuredClone(data.get(p)??initialLedgerState())}),update(p,fn){if(failCommit)return {ok:false,reason:'local_commit_failed'};const next=fn(structuredClone(data.get(p)??initialLedgerState()));if(next.ok)data.set(p,structuredClone(next.value));return next},stats:()=>({ok:true,value:{count:0,bytes:0,oldestMs:null}}),quarantine:()=>({ok:true,value:0}),pending:at=>({ok:true,value:[...data.values()].flatMap(d=>{const r=d.rows[0];return r&&!r.quarantined&&r.nextAttemptAtMs<=at?[structuredClone(r)]:[]})}),pruneState:()=>({ok:true,value:{lastPruneAt:null,skipFirstPrune:true}}),checkpointPrune:()=>({ok:true,value:undefined}),claimMaintenanceNotice:(reason,at)=>{const prev=noticeTimes.get(reason);if(prev!==undefined&&at-prev<86400000)return {ok:true,value:false};noticeTimes.set(reason,at);return {ok:true,value:true}},close(){}}
 let serial=0
 function queue(provider:UsageProvider='claude',value=1){const n=++serial;return successValue(ledger.update(provider,d=>acceptObservation(d,{operationId:`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`,envelope:d1Envelope({provider,rawText:JSON.stringify({value}),intervalSec:180}),nowMs:now,lastStartedAtMs:now,nextDueMs:now+180000,alerts:[{kind:'usage'}]})))}
 const query={authStopped:()=>false,async query(statements:unknown){calls.push(structuredClone(statements));return responses.shift()??{ok:true as const,value:(statements as unknown[]).map(()=>({success:true}))}}}
 return {noticeState:{claim:ledger.claimMaintenanceNotice},control:fakeD1Control(),ledger,data,calls,notices,alerts,responses,queue,query,clock:{now:()=>now},advance:(ms:number)=>{now+=ms},failCommit:(value:boolean)=>{failCommit=value},notice:{notify:async(e:unknown)=>{notices.push(e)}},notifyAlerts:async(a:unknown[])=>{alerts.push(a)}}
}
