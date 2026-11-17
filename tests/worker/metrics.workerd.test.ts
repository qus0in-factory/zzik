import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { METRICS_CRON } from '../../worker/domain/usage/export'

const migration1 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const migration2 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0002_trend.sql', import.meta.url)), 'utf8')
const migration4 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0004_metrics.sql', import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-17T05:00:00.000Z')
const priorDay = '2026-11-10'

async function applyMigrations(db: Awaited<ReturnType<Miniflare['getD1Database']>>): Promise<void> {
  for (const migration of [migration1, migration2, migration4]) {
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map((sql) => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
    }
  }
}

async function createBundle(contents: string): Promise<Miniflare> {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      contents,
    },
    bundle: true, write: false, format: 'esm', platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:sockets', 'node:*'],
    plugins: [{
      name: 'node-builtins',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => builtinModules.includes(args.path)
          ? { path: args.path.startsWith('node:') ? args.path : 'node:' + args.path, external: true } : undefined)
      },
    }],
    logLevel: 'silent',
  })
  return new Miniflare({
    workers: [{
      config: {
        name: 'zzik-metrics-test',
        compatibilityDate: '2026-11-11',
        compatibilityFlags: ['nodejs_compat'],
        triggers: [{ type: 'scheduled', schedule: METRICS_CRON }],
        env: {
          DB: { type: 'd1', id: 'zzik-metrics-test' },
          AA_API_KEY: { type: 'text', value: 'aa-secret' },
          OR_API_KEY: { type: 'text', value: 'or-secret' },
        },
        manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } },
      },
    }],
    log: new Log(LogLevel.NONE),
  })
}

describe('Given the actual Worker metrics cron and public route in workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    mf = await createBundle(`
      import { createWorker } from './worker/index.ts';
      const aaPage = (page) => ({
        tier: 'free',
        intelligence_index_version: '3.0',
        pagination: { page, total_pages: 2, has_more: page === 1 },
        data: page === 1
          ? [
              { slug: 'new/y', name: 'New Y', model_creator: { name: 'New' }, release_date: '2026-11-10', evaluations: { artificial_analysis_intelligence_index: 99 }, pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 2 } },
              { slug: 'a/x', name: 'A X', model_creator: { name: 'A' }, release_date: '2026-11-01', evaluations: { artificial_analysis_intelligence_index: 90 }, pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 2 } },
            ]
          : [
              { slug: 'b/x', name: 'B X', model_creator: { name: 'B' }, release_date: '2026-10-30', evaluations: { artificial_analysis_intelligence_index: 80 }, pricing: { price_1m_input_tokens: 1, price_1m_output_tokens: 2 } },
            ],
      });
      const orRankings = {
        data: [
          { date: '2026-11-17', model_permaslug: 'a/x', total_tokens: '600' },
          { date: '2026-11-17', model_permaslug: 'other', total_tokens: '400' },
          { date: '2026-11-10', model_permaslug: 'a/x', total_tokens: '500' },
          { date: '2026-11-10', model_permaslug: 'b/x', total_tokens: '300' },
          { date: '2026-11-10', model_permaslug: 'other', total_tokens: '200' },
        ],
        meta: { as_of: '2026-11-17T04:00:00Z' },
      };
      const fakeFetch = async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        if (url.includes('artificialanalysis.ai')) {
          const page = url.endsWith('page=2') ? 2 : 1;
          if (headers.get('x-api-key') !== 'aa-secret') return new Response('', { status: 401 });
          return new Response(JSON.stringify(aaPage(page)), { status: 200 });
        }
        if (url.includes('openrouter.ai/api/v1/datasets/rankings-daily')) {
          if (headers.get('Authorization') !== 'Bearer or-secret') return new Response('', { status: 401 });
          return new Response(JSON.stringify(orRankings), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };
      export default createWorker({ trendFetch: fakeFetch });
    `)
    db = await mf.getD1Database('DB')
    await applyMigrations(db)
    await db.prepare(
      `INSERT INTO trend_aa_snapshot (day, slug, name, creator, intelligence_index, domain_json, price_in, price_out, release_date, index_version)
       VALUES (?, ?, ?, ?, ?, '{}', 1, 2, '2026-11-01', '3.0')`,
    ).bind(priorDay, 'b/x', 'B X', 'B', 90).run()
    await db.prepare(
      `INSERT INTO trend_aa_snapshot (day, slug, name, creator, intelligence_index, domain_json, price_in, price_out, release_date, index_version)
       VALUES (?, ?, ?, ?, ?, '{}', 1, 2, '2026-11-01', '3.0')`,
    ).bind(priorDay, 'a/x', 'A X', 'A', 80).run()
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the metrics cron fetches AA and OR Then stores snapshots and serves projected blocks', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: METRICS_CRON, scheduledTime: NOW })

    const aa = await db.prepare('SELECT slug FROM trend_aa_snapshot WHERE day = ? ORDER BY slug').bind('2026-11-17').all<{ slug: string }>()
    expect(aa.results).toEqual([{ slug: 'a/x' }, { slug: 'b/x' }, { slug: 'new/y' }])
    const or = await db.prepare('SELECT model_permaslug AS id, total_tokens AS tokens FROM trend_or_ranking WHERE day = ? ORDER BY model_permaslug').bind('2026-11-17').all<{ id: string; tokens: string }>()
    expect(or.results).toEqual([{ id: 'a/x', tokens: '600' }, { id: 'other', tokens: '400' }])

    const response = await mf.dispatchFetch('http://localhost/pub/trend/metrics')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    const etag = response.headers.get('ETag')
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    const text = await response.text()
    expect(text).not.toContain('aa-secret')
    expect(text).not.toContain('or-secret')
    expect(text).not.toContain('total_tokens')
    expect(text).not.toContain('domain_json')
    expect(text).not.toContain('sourceItems')
    const body = JSON.parse(text) as {
      section: string
      items: unknown[]
      sources: Array<{ id: string; status: string }>
      blocks: Array<{ id: string; status: string; entries: Array<Record<string, unknown>>; attribution: string; version?: string }>
    }
    expect(body.section).toBe('metrics')
    expect(body.items).toEqual([])
    expect(body.sources.map((source) => source.id)).toEqual(['artificial-analysis', 'openrouter-rankings'])
    const aaBlock = body.blocks.find((block) => block.id === 'aa-intelligence')!
    expect(aaBlock).toMatchObject({ status: 'ok', version: '3.0' })
    expect(aaBlock.entries[0]).toMatchObject({ id: 'new/y', rank: 1, rankDelta: null, kind: 'new-top', index: 99 })
    expect(aaBlock.entries.find((entry) => entry.id === 'a/x')).toMatchObject({ rank: 2, rankDelta: 0 })
    expect(aaBlock.entries.find((entry) => entry.id === 'b/x')).toMatchObject({ rank: 3, rankDelta: -2 })
    const orBlock = body.blocks.find((block) => block.id === 'or-usage')!
    expect(orBlock.entries[0]).toMatchObject({ id: 'a/x', rank: 1, share7d: 0.6, kind: 'moved' })
    expect(orBlock.attribution).toContain('Licensed under CC BY 4.0')

    const notModified = await mf.dispatchFetch('http://localhost/pub/trend/metrics', { headers: { 'If-None-Match': etag! } })
    expect(notModified.status).toBe(304)
  })

  it('When no keys are configured Then the metrics cron writes nothing and the route stays not_ready', async () => {
    const mf2 = await createBundle(`
      import { createWorker } from './worker/index.ts';
      export default createWorker({ trendFetch: async () => { throw new Error('network must not be called'); } });
    `)
    try {
      const db2 = await mf2.getD1Database('DB')
      await applyMigrations(db2)
      const worker = await mf2.getWorker() as unknown as {
        scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
      }
      await worker.scheduled({ cron: METRICS_CRON, scheduledTime: NOW })
      const rows = await db2.prepare('SELECT section FROM trend_section').all<{ section: string }>()
      expect(rows.results).toEqual([])
      const response = await mf2.dispatchFetch('http://localhost/pub/trend/metrics')
      expect(response.status).toBe(503)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    } finally {
      await mf2.dispose()
    }
  })
})
