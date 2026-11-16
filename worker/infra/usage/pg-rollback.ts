import { createHash } from 'node:crypto'

export interface PgQueryResult<T> { rows: T[] }
export interface PgQueryable {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<PgQueryResult<T>>
}

export interface MigrationEvent {
  id: string
  provider: string
  runAtMs: number
  status: string
  rawSha256: string | null
  envelope: string
}

export interface MigrationSnapshot {
  provider: string
  runAtMs: number
  fetchedAtMs: number | null
  status: string
  rawSha256: string | null
  envelope: string
  collectorVersion: string
  updatedAtMs: number
}

export interface ReverseMigrationInput {
  events: readonly MigrationEvent[]
  snapshots: readonly MigrationSnapshot[]
}

export interface ReverseMigrationResult {
  events: number
  snapshots: number
  skipped: number
}

/** Canonical JSON: object keys sorted recursively, arrays in input order. */
export function canonicalMigrationJson(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])]))
    }
    return item
  }
  return JSON.stringify(canonical(value))
}

function rowHash(key: string, provider: string, runAtMs: number, status: string, rawSha256: string | null, envelope: string): string {
  const canonicalEnvelope = canonicalMigrationJson(JSON.parse(envelope))
  return createHash('sha256').update([key, provider, String(runAtMs), status, rawSha256 ?? '', canonicalEnvelope].join('|'), 'utf8').digest('hex')
}

export function migrationRowSha256(row: MigrationEvent | MigrationSnapshot): string {
  const key = 'id' in row ? row.id : row.provider
  return rowHash(key, row.provider, row.runAtMs, row.status, row.rawSha256, row.envelope)
}

interface ExistingEvent {
  id: string
  provider: string
  run_at_ms: string
  status: string
  raw_sha256: string | null
  envelope: string
}

interface ExistingSnapshot {
  provider: string
  run_at_ms: string
  status: string
  raw_sha256: string | null
  envelope: string
}

async function existingEvent(db: PgQueryable, id: string): Promise<ExistingEvent | null> {
  const result = await db.query<ExistingEvent>(
    `SELECT CAST(id AS TEXT) AS id, provider,
            (extract(epoch FROM run_at) * 1000)::bigint::text AS run_at_ms,
            status, raw_sha256, envelope::text AS envelope
       FROM usage_event WHERE id = CAST($1 AS BIGINT)`,
    [id],
  )
  return result.rows[0] ?? null
}

async function existingSnapshot(db: PgQueryable, provider: string): Promise<ExistingSnapshot | null> {
  const result = await db.query<ExistingSnapshot>(
    `SELECT provider,
            (extract(epoch FROM run_at) * 1000)::bigint::text AS run_at_ms,
            status, raw_sha256, envelope::text AS envelope
       FROM usage_snapshot WHERE provider = $1`,
    [provider],
  )
  return result.rows[0] ?? null
}

function eventHash(row: ExistingEvent): string {
  return rowHash(row.id, row.provider, Number(row.run_at_ms), row.status, row.raw_sha256, row.envelope)
}
function snapshotHash(row: ExistingSnapshot): string {
  return rowHash(row.provider, row.provider, Number(row.run_at_ms), row.status, row.raw_sha256, row.envelope)
}

async function syncSequence(db: PgQueryable): Promise<void> {
  const max = await db.query<{ max: string }>('SELECT COALESCE(MAX(id), 0)::text AS max FROM usage_event')
  const value = BigInt(max.rows[0]?.max ?? '0')
  const sequence = await db.query<{ last_value: string; is_called: boolean }>("SELECT last_value::text AS last_value, is_called FROM usage_event_id_seq")
  const currentLast = BigInt(sequence.rows[0]?.last_value ?? '1')
  const currentNext = sequence.rows[0]?.is_called ? currentLast + 1n : currentLast
  const targetNext = value > 0n ? value + 1n : 1n
  // The sequence is advanced outside the data transaction and never moved down.
  if (targetNext > currentNext) {
    if (value > 0n) await db.query("SELECT setval('usage_event_id_seq', CAST($1 AS BIGINT), true)", [value.toString()])
    else await db.query("SELECT setval('usage_event_id_seq', 1, false)")
  }
}

/**
 * Reverse-migrate already-committed D1 observations into PG.
 * All event/snapshot writes are one PG transaction; sequence advancement is deliberately after COMMIT.
 */
export async function reverseMigrateToPostgres(db: PgQueryable, input: ReverseMigrationInput): Promise<ReverseMigrationResult> {
  let insertedEvents = 0
  let insertedSnapshots = 0
  let skipped = 0
  await db.query('BEGIN')
  try {
    // Check every existing key before writing, so a mismatch aborts before any insert.
    const eventsToInsert: MigrationEvent[] = []
    for (const row of input.events) {
      const existing = await existingEvent(db, row.id)
      if (existing === null) {
        eventsToInsert.push(row)
      } else if (eventHash(existing) !== migrationRowSha256(row)) {
        throw new Error(`migration hash mismatch for usage_event ${row.id}`)
      } else {
        skipped += 1
      }
    }
    const snapshotsToInsert: MigrationSnapshot[] = []
    for (const row of input.snapshots) {
      const existing = await existingSnapshot(db, row.provider)
      if (existing === null) {
        snapshotsToInsert.push(row)
      } else if (snapshotHash(existing) !== migrationRowSha256(row)) {
        throw new Error(`migration hash mismatch for usage_snapshot ${row.provider}`)
      } else {
        skipped += 1
      }
    }

    for (const row of eventsToInsert) {
      await db.query(
        `INSERT INTO usage_event (id, provider, run_at, status, raw_sha256, envelope)
         OVERRIDING SYSTEM VALUE
         VALUES (CAST($1 AS BIGINT), $2, $3, $4, $5, CAST($6 AS JSONB))`,
        [row.id, row.provider, new Date(row.runAtMs), row.status, row.rawSha256, row.envelope],
      )
      insertedEvents += 1
    }
    for (const row of snapshotsToInsert) {
      await db.query(
        `INSERT INTO usage_snapshot (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at)
         VALUES ($1, CAST($2 AS JSONB), $3, $4, $5, $6, $7, $8)`,
        [row.provider, row.envelope, row.status, new Date(row.runAtMs), row.fetchedAtMs === null ? null : new Date(row.fetchedAtMs), row.rawSha256, row.collectorVersion, new Date(row.updatedAtMs)],
      )
      insertedSnapshots += 1
    }
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }

  // setval is deliberately outside the data transaction. PG sequences are not rolled back.
  await syncSequence(db)
  return { events: insertedEvents, snapshots: insertedSnapshots, skipped }
}
