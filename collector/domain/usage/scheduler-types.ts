import type {UsageProvider} from '../../../shared/usage-contract'
export interface CollectorTimer {schedule(ms:number,run:()=>void):()=>void}
export interface ScheduledProvider {
 id:UsageProvider
 intervalSec:number
 run(context:{markStarted():boolean;isStopping():boolean}):Promise<{reason?:string}|void>
}
