import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUCKET_CRON, EXPORT_CRON } from '../../worker/domain/usage/export'

const migration = readFileSync(fileURLToPath(new URL('../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-16T03:00:00.000Z')
const envelope = (): string => JSON.stringify({
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
})

describe('Given the actual Worker scheduled handler with D1 and R2 in workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
        contents: `
          import { createWorker } from './worker/index.ts';
          export default createWorker({createVerifier: () => ({verify: async () => ({ok:true,claims:{email:'test@example.invalid'}})})});
        `,
      },
      bundle: true, write: false, format: 'esm', platform: 'neutral',
      conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:sockets', 'node:*'],
      plugins: [{ name: 'node-builtins', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => builtinModules.includes(args.path)
          ? { path: args.path.startsWith('node:') ? args.path : 'node:' + args.path, external: true } : undefined)
      } }],
      logLevel: 'silent',
    })
    mf = new Miniflare({
      workers: [{
        config: {
          name: 'zzik-export-test',
          compatibilityDate: '2026-11-11',
          compatibilityFlags: ['nodejs_compat'],
          triggers: [{ type: 'scheduled', schedule: EXPORT_CRON }],
          env: {
            DB: { type: 'd1', id: 'zzik-export-test' },
            EXPORT_BUCKET: { type: 'r2', name: 'zzik-export-test' },
          },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    db = await mf.getD1Database('DB')
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
    }
    for (const id of ['9', '10', '100']) {
      await db.prepare('INSERT INTO usage_event (id, provider, run_at, status, envelope) VALUES (CAST(? AS INTEGER), ?, ?, ?, ?)')
        .bind(id, 'codex', 1_000, 'ok', envelope()).run()
    }
    await db.prepare('INSERT INTO usage_snapshot (provider, envelope, status, run_at, fetched_at, raw_sha256, collector_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind('codex', envelope(), 'ok', 1_000, 1_000, null, '0.6.20', 1_000).run()
    await db.prepare('INSERT INTO usage_write_receipt (operation_id, provider, write_seq, payload_sha256, created_at_ms) VALUES (?, ?, ?, ?, ?)')
      .bind('op-1', 'codex', 1, 'a'.repeat(64), 1_000).run()
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the export cron fires Then D1 is read incrementally, R2 gets a private object and the log records ok=1', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: EXPORT_CRON, scheduledTime: NOW })

    const logs = await db.prepare('SELECT object_key AS objectKey, event_high_water_id AS high, receipt_cut_ms AS cut, bytes, ok FROM usage_export_log ORDER BY ran_at_ms ASC, object_key ASC').all<{ objectKey: string; high: string; cut: number; bytes: number; ok: number }>()
    expect(logs.results.length).toBeGreaterThanOrEqual(2)
    expect(logs.results.every((row: { ok: number }) => row.ok === 1)).toBe(true)
    expect(logs.results.at(-1)).toMatchObject({ high: '100', cut: 1001 })

    const bucket = await mf.getR2Bucket('EXPORT_BUCKET') as unknown as {
      list(): Promise<{ objects: Array<{ key: string; size: number }> }>
      get(key: string): Promise<{ text(): Promise<string> } | null>
    }
    const objects = await bucket.list()
    expect(objects.objects.length).toBeGreaterThanOrEqual(2)
    expect(objects.objects.every((object: { key: string; size: number }) => object.key.startsWith('2026-11-16/part-') && object.size > 0)).toBe(true)
    const firstKey = objects.objects.map((object: { key: string }) => object.key).sort()[0]!
    const body = await (await bucket.get(firstKey))!.text()
    const parsed = JSON.parse(body) as { manifest: { eventHighWaterId: string }; events: Array<{ id: string }> }
    expect(parsed.events.map(row => row.id)).toEqual(['9', '10', '100'])
    expect(parsed.manifest.eventHighWaterId).toBe('100')
  })

  it('When the 15-minute cron fires Then it writes D1 boundaries and a checkpoint without touching R2', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    const r2 = await mf.getR2Bucket('EXPORT_BUCKET') as unknown as { list(): Promise<{ objects: unknown[] }> }
    const before = (await r2.list()).objects.length
    await worker.scheduled({ cron: BUCKET_CRON, scheduledTime: NOW })
    const checkpoint = await db.prepare("SELECT last_processed_id AS lastId FROM usage_bucket_checkpoint WHERE provider = 'codex'").all<{ lastId: string }>()
    expect(checkpoint.results[0]?.lastId).toBe('100')
    const boundaries = await db.prepare("SELECT count(*) AS count FROM usage_bucket_boundary WHERE provider = 'codex'").all<{ count: number }>()
    expect(boundaries.results[0]?.count).toBe(3)
    expect((await r2.list()).objects.length).toBe(before)
  })

  it('When a second export cron fires with no new events Then it still writes a heartbeat object without moving the high-water backwards', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: EXPORT_CRON, scheduledTime: NOW + 86_400_000 })

    const logs = await db.prepare('SELECT event_high_water_id AS high, bytes, ok FROM usage_export_log WHERE object_key LIKE ? ORDER BY object_key ASC').bind('2026-11-17/%').all<{ high: string; bytes: number; ok: number }>()
    expect(logs.results.length).toBeGreaterThanOrEqual(1)
    expect(logs.results.every((row: { ok: number; high: string; bytes: number }) => row.ok === 1 && row.high === '100' && row.bytes > 0)).toBe(true)
  })
})
