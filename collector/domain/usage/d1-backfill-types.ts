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
 source:{read():Promise<D1Result<{events:unknown[];snapshots:unknown[]}>>}
 destination:BackfillDestination
 checkpoint:BackfillCheckpointPort
 ledgerOutboxCount:number
 close():Promise<void>
}
