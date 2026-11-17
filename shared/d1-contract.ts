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
  /** Preserve original source sub-ms precision until checkMigrationTimeOrder has passed. */
  readonly runAt: string
  readonly status: UsageStatus
  readonly rawSha256: string | null
  readonly envelopeJson: string
}
