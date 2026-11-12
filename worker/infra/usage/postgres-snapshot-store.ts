import { eq, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { usageSnapshot } from '../../../shared/db/schema'
import type { UsageProvider } from '../../../shared/usage-contract'
import type { SnapshotStore, StoreResult } from '../../domain/usage/store'

/** The common Drizzle select surface accepts Postgres.js and PGlite in tests. */
export type SnapshotDatabase = Pick<PgDatabase<any, any, any>, 'select'>

/** P2 reads only the latest JSONB envelope; no credentials or driver ownership here. */
export class PostgresSnapshotStore implements SnapshotStore {
  constructor(private readonly db: SnapshotDatabase | null) {}

  async read(provider: UsageProvider): Promise<StoreResult> {
    if (this.db === null) return { ok: false, reason: 'storage_unavailable' }
    try {
      const rows = await this.db.select({ value: sql<string>`${usageSnapshot.envelope}::text` })
        .from(usageSnapshot).where(eq(usageSnapshot.provider, provider)).limit(1)
      return { ok: true, value: rows[0]?.value ?? null }
    } catch {
      return { ok: false, reason: 'storage_unavailable' }
    }
  }
}
