import type { UsageEnvelope, UsageProvider } from '../../../shared/usage-contract.ts'
import type { CollectorD1WriteV1, D1WriteReceipt, D1Result } from '../../../shared/d1-contract.ts'
export interface LedgerState {
  clockSkewCount?: number
  clockStopped?: boolean
  previous: UsageEnvelope | null
  lastEventAt: string | null
  remoteCommitted: UsageEnvelope | null
  remoteCommittedLastEventAt: string | null
  gate: unknown
  alerts: unknown
  lastRun: unknown
  nextSeq: number
  ackedSeq: number
  revision: number
  lastStartedAtMs: number | null
  nextDueMs: number | null
}
export interface OutboxRow {
  operation: CollectorD1WriteV1
  createdAtMs: number
  attempts: number
  nextAttemptAtMs: number
  alerts: unknown[]
  quarantined: boolean
}
export interface LedgerData { state: LedgerState; rows: OutboxRow[] }
export interface QueueStats { count: number; bytes: number; oldestMs: number | null }
export interface Observation {
  envelope: UsageEnvelope; operationId: string; nowMs: number
  lastStartedAtMs: number; nextDueMs: number; alerts: unknown[]
  gate?: unknown; alertBaseline?: unknown
}
/** A null receipt must be an authoritative absence, not a failed remote read. */
export type ReceiptFacts = Record<string, D1WriteReceipt | null>
export type LedgerTransition = (data: LedgerData) => D1Result<LedgerData>
export interface LedgerPort {
  read(provider: UsageProvider): D1Result<LedgerData>
  update(provider: UsageProvider, transition: LedgerTransition): D1Result<LedgerData>
  stats(): D1Result<QueueStats>
  quarantine(nowMs: number): D1Result<number>
  pending(nowMs: number): D1Result<OutboxRow[]>
  pruneState(): D1Result<{lastPruneAt: string | null; skipFirstPrune: boolean;skippedAtMs?:number}>
  checkpointPrune(input:{kind:'skipped'|'completed';atMs:number}):D1Result<void>
  claimMaintenanceNotice(reason:string,atMs:number):D1Result<boolean>
  close(): void
}
/** B2 supplies the transport; B1 has no sender and no runtime assembly. */
export interface LedgerSenderPort { send(operation: CollectorD1WriteV1): Promise<D1Result<D1WriteReceipt>> }
