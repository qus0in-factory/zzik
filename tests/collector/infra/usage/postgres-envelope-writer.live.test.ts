import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { createPostgresEnvelopeWriter } from '../../../../collector/infra/usage/postgres-envelope-writer.mjs'
import { PostgresSnapshotStore } from '../../../../worker/infra/usage/postgres-snapshot-store'
import { parseStoredSnapshot } from '../../../../worker/domain/usage/stored-snapshot'
import { decodeUsageSnapshot } from '../../../../src/domain/usage/snapshot'
import type { UsageEnvelope } from '../../../../shared/usage-contract'

// Opt-in: DB_URL must be explicitly supplied. Only synthetic envelopes are written,
// in a unique schema; transaction-local search_path also works through Neon pooling.
describe.skipIf(!process.env.DB_URL)('Given the real postgres.js JSONB wire protocol', () => {
  it('When the collector writes Then snapshot and event are objects and the Worker/frontend decode succeeds', async () => {
    const schema = `zzik_test_${randomUUID().replaceAll('-', '')}`
    const searchPath = `SET LOCAL search_path TO "${schema}"`
    const client = postgres(process.env.DB_URL!, {
      max: 1, prepare: false, connect_timeout: 10, idle_timeout: 5, onnotice: () => {},
    })
    const envelope: UsageEnvelope = {
      schema: 1, provider: 'claude', status: 'ok', called: true,
      runAt: '2026-11-13T00:00:00Z', fetchedAt: '2026-11-13T00:00:00Z',
      httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null,
      intervalSec: 900, collectorVersion: '0.6.0',
      rawText: '{ "five_hour": { "utilization": 38 }, "description": "[가림]" }',
      rawOmitted: null, rawRedacted: ['description'],
    }
    let stage = 'create schema'
    try {
      await client.unsafe(`CREATE SCHEMA "${schema}"`)
      stage = 'migrate test schema'
      const migration = await readFile(new URL('../../../../drizzle/0000_loud_robin_chapel.sql', import.meta.url), 'utf8')
      await client.begin(async tx => {
        await tx.unsafe(searchPath)
        await tx.unsafe(migration)
      })
      stage = 'write envelopes'
      const writer = createPostgresEnvelopeWriter({ execute: async (text, params) => {
        const result = await client.unsafe(text, params)
        // The writer owns BEGIN/COMMIT. Set scope within its transaction, never
        // the pooled session, and use the same unsafe(text, params) as main.mjs.
        if (text === 'BEGIN') await client.unsafe(searchPath)
        return result
      } })
      for (const changed of [true, false]) {
        expect(await writer.write(JSON.stringify(envelope), {
          provider: envelope.provider, status: envelope.status, runAt: envelope.runAt,
          fetchedAt: envelope.fetchedAt, rawSha256: 'synthetic-hash',
          collectorVersion: envelope.collectorVersion, changed,
        })).toEqual({ ok: true })
      }
      stage = 'check JSONB types'
      const types = await client.unsafe(`SELECT jsonb_typeof(envelope) AS kind FROM "${schema}".usage_snapshot
        UNION ALL SELECT jsonb_typeof(envelope) AS kind FROM "${schema}".usage_event`)
      expect(types.map(row => row.kind)).toEqual(['object', 'object'])
      stage = 'read and decode'
      await drizzle(client).transaction(async tx => {
        await tx.execute(sql.raw(searchPath))
        const store = new PostgresSnapshotStore(tx)
        const found = await store.read('claude')
        expect(found.ok).toBe(true)
        if (!found.ok || !found.value) throw Error('Synthetic snapshot missing')
        const stored = parseStoredSnapshot(found.value, 'claude')
        expect(stored).toEqual({ ok: true, snapshot: envelope })
        if (!stored.ok) throw Error('Synthetic snapshot corrupt')
        expect(decodeUsageSnapshot({ snapshot: stored.snapshot }, 'claude')).toMatchObject({
          ok: true, rawText: envelope.rawText, usage: { five_hour: { utilization: 38 } },
          collection: { rawRedacted: ['description'] },
        })
        expect(await store.read('codex')).toEqual({ ok: true, value: null })
      })
    } catch (error) {
      // Driver errors may contain connection details. Assertion payloads contain
      // only this test's synthetic data, so preserve those for useful failures.
      if (error instanceof Error && error.name === 'AssertionError') throw error
      const code = typeof error === 'object' && error !== null && 'code' in error
        && typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'withheld'
      throw new Error(`Postgres integration failed at ${stage} (code: ${code}; details withheld)`)
    } finally {
      try {
        await client.unsafe('ROLLBACK')
        await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      } catch {
        throw new Error('Postgres integration cleanup failed (connection details withheld)')
      } finally {
        await client.end({ timeout: 5 })
      }
    }
  }, 60_000)
})
