import type {D1MigrationRow,D1Result,D1SqlStatement} from '../../../shared/d1-contract'
export interface BackfillRow {row:D1MigrationRow;sha256:string;updatedAtMs?:number}
export interface BackfillPlan {items:BackfillRow[];summary:{events:number;snapshots:number;minId:string|null;maxId:string|null;planSha256:string}}
export interface BackfillFacts {receipts:number;dirtySnapshots:number;dirtyEvents:number;events:number;snapshots:number;maxId:string|null;sequence:string|null}
export interface BackfillDestination {
 inspect():Promise<D1Result<BackfillFacts>>
 read(kind:'event'|'snapshot',keys:string[]):Promise<D1Result<D1MigrationRow[]>>
 write(statements:readonly D1SqlStatement[]):Promise<D1Result<void>>
}
export interface BackfillCheckpoint {planSha256:string;completed:number}
export interface BackfillCheckpointPort {read():D1Result<BackfillCheckpoint|null>;write(value:BackfillCheckpoint):D1Result<void>}
export interface BackfillCommandPorts {
 source:{read():Promise<D1Result<BackfillInput>>}
 destination:BackfillDestination
 checkpoint:BackfillCheckpointPort
 ledgerOutboxCount:number
 close():Promise<void>
}
export interface PgBackfillFacts {events:number;snapshots:number;minId:string|null;maxId:string|null;eventsByProvider:Record<string,number>}
export interface BackfillReplayPlan {
 sourceFacts?:PgBackfillFacts
 summary:BackfillPlan['summary']
 pages():AsyncIterable<readonly BackfillRow[]>
}
export interface BackfillSpool {
 append(kind:'event'|'snapshot',rows:unknown[]):D1Result<void>
 seal():D1Result<BackfillReplayPlan>
 close():void
}
export interface BackfillPageSource {
 scan(consume:(kind:'event'|'snapshot',rows:Record<string,unknown>[])=>D1Result<void>|Promise<D1Result<void>>):Promise<D1Result<PgBackfillFacts>>
}
export type BackfillInput={events:unknown[];snapshots:unknown[]}|BackfillReplayPlan
