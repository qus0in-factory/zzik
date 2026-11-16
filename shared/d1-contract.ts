/** ADR 0.10 §3–4. Inert types shared by collector and migration tools; no transport. */
import type { UsageProvider, UsageStatus } from './usage-contract.ts'

export type D1Result<T, R extends string = string> = { ok: true; value: T } | { ok: false; reason: R }
export interface CollectorD1WriteV1 {
  readonly version: 1
  readonly operationId: string
  readonly provider: UsageProvider
  readonly writeSeq: number
  readonly envelopeJson: string
  readonly payloadSha256: string
  readonly emitEvent: boolean
}
export type D1SqlParam = string | number | null
export interface D1SqlStatement { readonly sql: string; readonly params: readonly D1SqlParam[] }
export interface D1WriteReceipt {
  readonly operationId: string
  readonly provider: UsageProvider
  readonly writeSeq: number
  readonly payloadSha256: string
  readonly createdAtMs: number
}
/** id=null denotes a snapshot; event ids are canonical positive signed-64 decimal strings. */
export interface D1MigrationRow {
  readonly id: string | null
  readonly provider: UsageProvider
  /** Preserve original PG sub-ms precision until checkMigrationTimeOrder has passed. */
  readonly runAt: string
  readonly status: UsageStatus
  readonly rawSha256: string | null
  readonly envelopeJson: string
}
export interface D1OperationFacts {
  readonly operation: CollectorD1WriteV1
  readonly outboxPresent: boolean
  /** null means confirmed absent at a quiesced read, never a failed query. */
  readonly receipt: D1WriteReceipt | null
  readonly receiptUnavailable?: boolean
  /** expected is the explicit D1 export target, not a guess from provider/runAt alone. */
  readonly pgRow?: { readonly expected: D1ComparableMigrationRow; readonly actual: D1ComparableMigrationRow | null }
}
export interface D1OperationClassification {
  readonly operationId: string
  readonly delivery: 'acknowledged' | 'response_lost' | 'unsent'
  readonly action: 'none' | 'acknowledge_local' | 'replay_same_operation' | 'clear_after_pg_commit'
  readonly pg: 'not_checked' | 'missing' | 'matching' | 'snapshot_replace'
}

/** Structural transport compatibility with z-ds PG rollback tools; validated before use. */
export interface PgRollbackEventRow {
  readonly id: string
  readonly provider: string
  readonly runAtMs: number
  readonly status: string
  readonly rawSha256: string | null
  readonly envelope: string
}
export interface PgRollbackSnapshotRow {
  readonly provider: string
  readonly runAtMs: number
  readonly fetchedAtMs: number | null
  readonly status: string
  readonly rawSha256: string | null
  readonly envelope: string
  readonly collectorVersion: string
  readonly updatedAtMs: number
}
export type D1ComparableMigrationRow = D1MigrationRow | PgRollbackEventRow | PgRollbackSnapshotRow
