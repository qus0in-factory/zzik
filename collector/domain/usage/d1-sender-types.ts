import type { D1SqlStatement } from '../../../shared/d1-contract.ts'
export type D1QueryResult = {ok:true;value:Record<string,unknown>[]} | {ok:false;reason:'auth'|'invalid'|'retry'|'disabled'|'local';status:number|null;retryAfterMs:number}
export interface D1QueryPort {
 query(statements:readonly D1SqlStatement[]):Promise<D1QueryResult>
 authStopped():boolean
}
export interface D1Clock {now():number}
export interface D1NoticePort {notify(event:{reason:string;provider?:string;status?:number|null}):Promise<void>}
export interface D1FetchResponse {status:number;headers:{get(name:string):string|null};json():Promise<unknown>}
export type D1Fetch = (url:string,init:{method:string;headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<D1FetchResponse>
export interface D1ControlState {
 credentialKey:string|null
 authStopped:boolean
 lastHealthCheckAtMs:number|null
 nextRequestAtMs:number
 paused:Partial<Record<import('../../../shared/usage-contract.ts').UsageProvider,string>>
}
export interface D1ControlPort {
 read():import('../../../shared/d1-contract.ts').D1Result<D1ControlState>
 write(state:D1ControlState):import('../../../shared/d1-contract.ts').D1Result<void>
}

export interface MaintenanceNoticeState {claim(reason:string,atMs:number):import('../../../shared/d1-contract.ts').D1Result<boolean>}

/** Access tokens are transient in-memory values, never ledger/control payloads. */
export interface D1Credential {token:string}
export interface D1CredentialPort {
 get():Promise<import('../../../shared/d1-contract.ts').D1Result<D1Credential>>
 refresh(rejectedToken:string):Promise<import('../../../shared/d1-contract.ts').D1Result<D1Credential>>
}
export interface WranglerOAuthFilePort {
 read():import('../../../shared/d1-contract.ts').D1Result<D1Credential & {expiresAtMs:number}>
 expire(expectedToken:string):import('../../../shared/d1-contract.ts').D1Result<void>
}
export interface OAuthRefreshPort {run():Promise<import('../../../shared/d1-contract.ts').D1Result<void>>}
