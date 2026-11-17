import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TREND_CRON } from '../../worker/domain/usage/export'

const migration1 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const migration2 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0002_trend.sql', import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-17T00:00:00.000Z')
const models = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-x': {
        id: 'claude-x',
        name: 'Claude X',
        release_date: '2026-11-16',
        cost: { input: 3, output: 15 },
        canonical_model_id: 'anthropic/claude-x',
        open_weights: false,
      },
    },
  },
  reseller: {
    id: 'reseller',
    models: {
      'claude-x': {
        id: 'claude-x',
        name: 'Claude X resold',
        release_date: '2026-11-15',
        cost: { input: 4, output: 16 },
        canonical_model_id: 'anthropic/claude-x',
        open_weights: false,
      },
    },
  },
}

describe('Given the actual Worker trend cron and public route in workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
        contents: `
          import { createWorker } from './worker/index.ts';
          const fixture = ${JSON.stringify(models)};
          const fakeFetch = async (_url, init) => {
            const headers = init?.headers ?? {};
            const inm = headers['If-None-Match'];
            if (inm === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
            return new Response(JSON.stringify(fixture), { status: 200, headers: { etag: '"v1"', 'content-type': 'application/json' } });
          };
          export default createWorker({ trendFetch: fakeFetch });
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
          name: 'zzik-trend-test',
          compatibilityDate: '2026-11-11',
          compatibilityFlags: ['nodejs_compat'],
          triggers: [{ type: 'scheduled', schedule: TREND_CRON }],
          env: { DB: { type: 'd1', id: 'zzik-trend-test' } },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    db = await mf.getD1Database('DB')
    for (const migration of [migration1, migration2]) {
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
        await db.prepare(statement).run()
      }
    }
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the trend cron fetches models.dev Then writes D1 and /pub returns the section with ETag and cache', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW })

    const sections = await db.prepare('SELECT section, payload, payload_sha256 AS sha, generated_at AS at FROM trend_section').all<{ section: string; payload: string; sha: string; at: number }>()
    expect(sections.results).toHaveLength(1)
    expect(sections.results[0]).toMatchObject({ section: 'new-models', sha: expect.stringMatching(/^[0-9a-f]{64}$/), at: NOW })
    const seen = await db.prepare('SELECT canonical_id AS id, first_seen_at AS at FROM trend_model_seen').all<{ id: string; at: number }>()
    expect(seen.results).toEqual([{ id: 'anthropic/claude-x', at: NOW }])
    const state = await db.prepare('SELECT etag, ok, http_status AS status FROM trend_source_state WHERE source = ?').bind('models.dev').all<{ etag: string; ok: number; status: number }>()
    expect(state.results[0]).toMatchObject({ etag: '"v1"', ok: 1, status: 200 })

    const response = await mf.dispatchFetch('http://localhost/pub/trend/new-models')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    expect(response.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    const body = await response.json() as { section: string; items: Array<{ id: string; providers: string[] }> }
    expect(body.section).toBe('new-models')
    expect(body.items).toEqual([expect.objectContaining({ id: 'anthropic/claude-x', providers: ['anthropic', 'reseller'] })])

    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    expect(index.status).toBe(200)
    expect(await index.json()).toMatchObject({ sections: [{ id: 'new-models', count: 1, status: 'ok' }] })

    const notModified = await mf.dispatchFetch('http://localhost/pub/trend/new-models', { headers: { 'If-None-Match': response.headers.get('ETag')! } })
    expect(notModified.status).toBe(304)
    expect(await notModified.text()).toBe('')
  })

  it('When the next trend cron gets 304 Then keeps the section and records the 304 source state', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    const before = await db.prepare('SELECT payload_sha256 AS sha FROM trend_section WHERE section = ?').bind('new-models').all<{ sha: string }>()
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 7_200_000 })
    const after = await db.prepare('SELECT payload_sha256 AS sha FROM trend_section WHERE section = ?').bind('new-models').all<{ sha: string }>()
    expect(after.results[0]?.sha).toBe(before.results[0]?.sha)
    const state = await db.prepare('SELECT http_status AS status FROM trend_source_state WHERE source = ?').bind('models.dev').all<{ status: number }>()
    expect(state.results[0]?.status).toBe(304)
  })

  it('When 8 days pass and the cron still gets 304 Then the public section re-evaluates and drops the expired item', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 8 * 86_400_000 })

    const response = await mf.dispatchFetch('http://localhost/pub/trend/new-models')
    expect(response.status).toBe(200)
    const body = await response.json() as { items: unknown[]; generatedAt: string }
    expect(body.items).toEqual([])
    expect(body.generatedAt).toBe(new Date(NOW + 8 * 86_400_000).toISOString())
    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    expect(await index.json()).toMatchObject({ sections: [{ id: 'new-models', count: 0, status: 'ok' }] })
  })
})
