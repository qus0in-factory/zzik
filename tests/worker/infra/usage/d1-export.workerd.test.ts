import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { restoreFromExportObjects } from '../../../../worker/app/usage/restore-d1-export'
import { buildExportDocument, serializeExportDocument } from '../../../../worker/domain/usage/export'
import { D1ExportSource, D1RestoreTarget } from '../../../../worker/infra/usage/d1-export-store'
import { R2ExportObjectStore } from '../../../../worker/infra/usage/r2-export-bucket'
import type { R2BucketLike } from '../../../../worker/infra/usage/r2-export-bucket'
import type { ExportDocument } from '../../../../worker/domain/usage/export'
import { FakeExportObjectReader } from '../../../fakes/export-ports'

const migration = readFileSync(fileURLToPath(new URL('../../../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-16T03:00:00.000Z')
const envelope = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  schema: 1,
  provider: 'codex',
  status: 'ok',
  called: true,
  runAt: '2026-11-16T00:00:00.000Z',
  fetchedAt: '2026-11-16T00:00:00.000Z',
  httpStatus: 200,
  retryAt: null,
  tokenExpiresAt: null,
  kvTokenExpiresAt: null,
  intervalSec: 900,
  collectorVersion: '0.6.20',
  rawText: null,
  rawOmitted: null,
  rawRedacted: [],
  ...overrides,
})

async function applyMigration(db: Awaited<ReturnType<Miniflare['getD1Database']>>): Promise<void> {
  for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
    await db.prepare(statement).run()
  }
}

describe('Given the D1 export adapter inside actual workerd', () => {
  let mf: Miniflare
  let sourceDb: Awaited<ReturnType<Miniflare['getD1Database']>>
  let restoreDb: Awaited<ReturnType<Miniflare['getD1Database']>>
  let restoreR2Db: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    mf = new Miniflare({
      workers: [{
        config: {
          name: 'd1-export-test',
          compatibilityDate: '2026-11-11',
          env: {
            DB: { type: 'd1', id: 'd1-export-source' },
            DB2: { type: 'd1', id: 'd1-export-restore' },
            DB3: { type: 'd1', id: 'd1-export-restore-r2' },
            EXPORT_BUCKET: { type: 'r2', name: 'd1-export-bucket' },
          },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: 'export default { fetch() { return new Response("ok") } }' } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    sourceDb = await mf.getD1Database('DB')
    restoreDb = await mf.getD1Database('DB2')
    restoreR2Db = await mf.getD1Database('DB3')
    await applyMigration(sourceDb)
    await applyMigration(restoreDb)
    await applyMigration(restoreR2Db)
    for (const [id, runAt] of [['9', 1_000], ['10', 1_000], ['100', 1_000]] as const) {
      await sourceDb.prepare('INSERT INTO usage_event (id, provider, run_at, status, envelope) VALUES (CAST(? AS INTEGER), ?, ?, ?, ?)')
        .bind(id, 'codex', runAt, 'ok', envelope()).run()
    }
    for (const provider of ['claude', 'codex'] as const) {
      await sourceDb.prepare('INSERT INTO usage_snapshot (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(provider, envelope({ provider }), 'ok', 1_000, 1_000, null, '0.6.20', 1_000).run()
    }
    for (const [operationId, createdAtMs] of [['op-9', 100], ['op-10', 100], ['op-100', 200]] as const) {
      await sourceDb.prepare('INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms) VALUES (?, ?, ?, ?, ?)')
        .bind(operationId, 'codex', Number(operationId.slice(3)), 'a'.repeat(64), createdAtMs).run()
    }
  }, 30_000)

  afterAll(async () => { await mf.dispose() })

  it('When reading events after a high-water Then decimal ids are ordered numerically and the page limit holds', async () => {
    const source = new D1ExportSource(sourceDb)
    await expect(source.readEventPage('9', 10, 4 * 1024 * 1024)).resolves.toMatchObject([
      { id: '10', provider: 'codex', runAtMs: 1_000, status: 'ok', rawSha256: null },
      { id: '100', provider: 'codex', runAtMs: 1_000, status: 'ok', rawSha256: null },
    ])
    const firstPage = await source.readEventPage('0', 2, 4 * 1024 * 1024)
    expect(firstPage.map(row => row.id)).toEqual(['9', '10'])
  })

  it('When the byte budget equals the first envelope Then only the first row is returned', async () => {
    const source = new D1ExportSource(sourceDb)
    const rows = await source.readEventPage('0', 10, new TextEncoder().encode(envelope()).length)
    expect(rows.map(row => row.id)).toEqual(['9'])
  })

  it('When export logs exist Then the last ok log is scoped to the generation and part numbers continue', async () => {
    const source = new D1ExportSource(sourceDb)
    await source.appendLog({ ranAtMs: NOW, objectKey: '2026-11-16/part-0001.json', eventHighWaterId: '10', receiptCutMs: 101, dataGeneration: 0, bytes: 10, ok: 1 })
    await source.appendLog({ ranAtMs: NOW, objectKey: '2026-11-16/part-0002.json', eventHighWaterId: '100', receiptCutMs: 201, dataGeneration: 0, bytes: 10, ok: 1 })
    await source.appendLog({ ranAtMs: NOW, objectKey: '2026-11-16/part-0003.json', eventHighWaterId: '5', receiptCutMs: 0, dataGeneration: 1, bytes: 10, ok: 1 })
    await expect(source.readLastOkLog(0)).resolves.toMatchObject({ eventHighWaterId: '100', receiptCutMs: 201 })
    await expect(source.readLastOkLog(1)).resolves.toMatchObject({ eventHighWaterId: '5' })
    await expect(source.readLastOkLog(2)).resolves.toBeNull()
    await expect(source.readLastPartNumber('2026-11-16')).resolves.toBe(3)
  })

  it('When export objects are restored into a scratch D1 Then explicit ids, snapshots, receipts and the sequence fence are applied', async () => {
    const source = new D1ExportSource(sourceDb)
    const events = await source.readEventPage('0', 10, 4 * 1024 * 1024)
    const snapshots = await source.readSnapshots()
    const receipts = await source.readReceiptPage({ createdAtMs: 0, operationId: null }, 10)
    const document: ExportDocument = buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '100', receiptCutMs: 201, dataGeneration: 0, exportedAtMs: NOW },
      events,
      snapshots,
      receipts,
    })
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(document))
    const target = new D1RestoreTarget(restoreDb)

    await expect(restoreFromExportObjects(reader, target)).resolves.toMatchObject({
      ok: true,
      value: { events: 3, snapshots: 2, receipts: 3, maxEventId: '100', nextIdFence: '1000100', requiresScanVersionBump: true },
    })
    const ids = await restoreDb.prepare('SELECT CAST(id AS TEXT) AS id FROM usage_event ORDER BY CAST(id AS INTEGER) ASC').all<{ id: string }>()
    expect(ids.results.map((row: { id: string }) => row.id)).toEqual(['9', '10', '100'])
    const snapshotsRows = await restoreDb.prepare('SELECT provider FROM usage_snapshot ORDER BY provider ASC').all<{ provider: string }>()
    expect(snapshotsRows.results.map((row: { provider: string }) => row.provider)).toEqual(['claude', 'codex'])
    const receiptsRows = await restoreDb.prepare('SELECT operation_id AS operationId FROM usage_write_receipt ORDER BY operation_id ASC').all<{ operationId: string }>()
    expect(receiptsRows.results.map((row: { operationId: string }) => row.operationId)).toEqual(['op-10', 'op-100', 'op-9'])
    await restoreDb.prepare('INSERT INTO usage_event (provider, run_at, status, envelope) VALUES (?, ?, ?, ?)')
      .bind('codex', 2_000, 'ok', envelope()).run()
    const max = await restoreDb.prepare('SELECT CAST(max(id) AS TEXT) AS id FROM usage_event').all<{ id: string }>()
    expect(max.results[0]?.id).toBe('1000100')
  })

  it('When the same objects are restored again Then duplicate event rows are skipped', async () => {
    const source = new D1ExportSource(sourceDb)
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '100', receiptCutMs: 201, dataGeneration: 0, exportedAtMs: NOW },
      events: await source.readEventPage('0', 10, 4 * 1024 * 1024),
      snapshots: await source.readSnapshots(),
      receipts: await source.readReceiptPage({ createdAtMs: 0, operationId: null }, 10),
    })))
    const target = new D1RestoreTarget(restoreDb)
    await expect(restoreFromExportObjects(reader, target)).resolves.toMatchObject({ ok: true, value: { events: 0 } })
  })

  it('When export objects are read back from R2 Then the same bytes restore into a scratch D1', async () => {
    const bucket = await mf.getR2Bucket('EXPORT_BUCKET') as unknown as R2BucketLike
    const store = new R2ExportObjectStore(bucket)
    const source = new D1ExportSource(sourceDb)
    const document = buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '100', receiptCutMs: 0, dataGeneration: 0, exportedAtMs: NOW },
      events: await source.readEventPage('0', 10, 4 * 1024 * 1024),
    })
    const body = serializeExportDocument(document)
    const bytes = await store.putObject('2026-11-16/part-0001.json', body)
    expect(bytes).toBeGreaterThan(0)
    expect(await store.list()).toContain('2026-11-16/part-0001.json')
    expect(await store.read('2026-11-16/part-0001.json')).toBe(body)
    await expect(restoreFromExportObjects(store, new D1RestoreTarget(restoreR2Db)))
      .resolves.toMatchObject({ ok: true, value: { events: 3 } })
  })

  it('When an exported id conflicts with a different restored row Then the restore fails', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '9', receiptCutMs: 0, dataGeneration: 0, exportedAtMs: NOW },
      events: [{ id: '9', provider: 'codex', runAtMs: 1_000, status: 'ok', rawSha256: null, envelope: envelope({ intervalSec: 180 }), operationId: null }],
    })))
    await expect(restoreFromExportObjects(reader, new D1RestoreTarget(restoreDb)))
      .resolves.toMatchObject({ ok: false, reason: 'export_restore_conflict' })
  })
})
