import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../../../fakes/pglite-db'
import { usageSnapshot } from '../../../../shared/db/schema'
import { PostgresSnapshotStore } from '../../../../worker/infra/usage/postgres-snapshot-store'
import type { SnapshotDatabase } from '../../../../worker/infra/usage/postgres-snapshot-store'
import type { UsageEnvelope } from '../../../../shared/usage-contract'

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => { await cleanup?.(); cleanup = undefined })
describe('Given the PostgreSQL snapshot adapter', () => {
  it('When reading Then selects only the requested provider and preserves the envelope contract', async () => {
    const test = await createTestDb()
    cleanup = test.close
    const envelope = { schema: 1, provider: 'claude', rawText: '{"five_hour":{"utilization":12}}', rawRedacted: ['account_email'] } as unknown as UsageEnvelope
    await test.db.insert(usageSnapshot).values({
      provider: 'claude', envelope, status: 'ok', runAt: new Date('2026-11-13T00:00:00Z'), collectorVersion: '0.5.0',
    })
    const store = new PostgresSnapshotStore(test.db as SnapshotDatabase)
    const result = await store.read('claude')
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.parse(result.value!)).toEqual(envelope)
    expect(await store.read('codex')).toEqual({ ok: true, value: null })
  })
  it('When DB is missing or throws Then returns storage_unavailable without connection details', async () => {
    expect(await new PostgresSnapshotStore(null).read('claude')).toEqual({ ok: false, reason: 'storage_unavailable' })
    const db = { select() { throw new Error('postgres://sensitive-host') } } as unknown as SnapshotDatabase
    expect(await new PostgresSnapshotStore(db).read('claude')).toEqual({ ok: false, reason: 'storage_unavailable' })
  })
})
