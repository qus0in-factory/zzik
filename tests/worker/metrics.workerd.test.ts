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
const migration5 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0005_aa_speed.sql', import.meta.url)), 'utf8')
const migration6 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0006_aa_cost.sql', import.meta.url)), 'utf8')
const NOW = Date.parse('2026-11-17T05:00:00.000Z')

async function applyMigrations(db: Awaited<ReturnType<Miniflare['getD1Database']>>): Promise<void> {
  for (const migration of [migration1, migration2, migration4, migration5, migration6]) {
    for (const statement of migration.replace(/^--.*$/gm, '').split(';').map((sql) => sql.trim()).filter(Boolean)) {
      await db.prepare(statement).run()
    }
  }
}

let workerSeq = 0

async function createBundle(contents: string, options: { keys?: boolean } = {}): Promise<Miniflare> {
  workerSeq += 1
  const keys = options.keys ?? true
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
        name: `zzik-metrics-test-${workerSeq}`,
        compatibilityDate: '2026-11-11',
        compatibilityFlags: ['nodejs_compat'],
        triggers: [{ type: 'scheduled', schedule: METRICS_CRON }],
        env: {
          DB: { type: 'd1', id: `zzik-metrics-test-${workerSeq}` },
          ...(keys ? { AA_API_KEY: { type: 'text', value: 'aa-secret' }, OR_API_KEY: { type: 'text', value: 'or-secret' } } : {}),
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
          if (headers.get('x-api-key') !== 'aa-secret') return new Response('', { status: 401 });
          return new Response(JSON.stringify({
            intelligence_index_version: '3.0',
            pagination: { page: 1, total_pages: 1, has_more: false },
            data: [
              { slug: 'a/x', name: 'A X', model_creator: { name: 'A' }, evaluations: { artificial_analysis_intelligence_index: 90 } },
              { slug: 'b/x', name: 'B X', model_creator: { name: 'B' }, evaluations: { artificial_analysis_intelligence_index: 80 } },
              { slug: 'c/x', name: 'C X', model_creator: { name: 'C' }, evaluations: { artificial_analysis_intelligence_index: 70 } },
            ],
          }), { status: 200 });
        }
        if (url.includes('openrouter.ai/api/v1/datasets/rankings-daily')) {
          if (headers.get('Authorization') !== 'Bearer or-secret') return new Response('', { status: 401 });
          return new Response(JSON.stringify(orRankings), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };
      export default createWorker({ trendFetch: fakeFetch });
    `, { keys: true })
    db = await mf.getD1Database('DB')
    await applyMigrations(db)
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the metrics cron runs with keys Then it stores AA top candidates internally and serves one notable-model sentence', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: METRICS_CRON, scheduledTime: NOW })

    const aa = await db.prepare('SELECT COUNT(*) AS count FROM trend_aa_snapshot').all<{ count: number }>()
    expect(Number(aa.results[0]?.count)).toBe(3)
    const aaRows = await db.prepare('SELECT slug FROM trend_aa_snapshot ORDER BY slug').all<{ slug: string }>()
    expect(aaRows.results.map((row: { slug: string }) => row.slug)).toEqual(['a/x', 'b/x', 'c/x'])
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
    expect(text).not.toContain('aa-intelligence')
    expect(text).not.toContain('total_tokens')
    expect(text).not.toContain('domain_json')
    const body = JSON.parse(text) as {
      section: string
      items: unknown[]
      sources: Array<{ id: string; status: string }>
      blocks: Array<{ id: string; status: string; entries: Array<Record<string, unknown>>; attribution: string }>
      aaCitation?: string
    }
    expect(body.aaCitation).toBe('요즘 주목받는 모델은 A X, B X, C X 등입니다.')
    expect(text).not.toMatch(/1위|90|Intelligence Index/)
    expect(body.section).toBe('metrics')
    expect(body.items).toEqual([])
    expect(body.sources.map((source) => source.id)).toEqual(['openrouter-rankings'])
    expect(body.blocks.map((block) => block.id)).toEqual(['or-usage'])
    const orBlock = body.blocks[0]!
    expect(orBlock.entries[0]).toMatchObject({ id: 'a/x', rank: 1, share7d: 0.6, kind: 'moved' })

    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    expect(index.status).toBe(200)
    const indexBody = await index.json() as { sections: Array<{ id: string; checkedAt?: string; status: string }> }
    expect(indexBody.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'metrics', checkedAt: new Date(NOW).toISOString(), status: 'ok' }),
    ]))
    expect(orBlock.attribution).toContain('Licensed under CC BY 4.0')

    const notModified = await mf.dispatchFetch('http://localhost/pub/trend/metrics', { headers: { 'If-None-Match': etag! } })
    expect(notModified.status).toBe(304)
  })

  it('When no keys are configured Then the metrics cron writes nothing and the route stays not_ready', async () => {
    const mf2 = await createBundle(`
      import { createWorker } from './worker/index.ts';
      export default createWorker({ trendFetch: async () => { throw new Error('network must not be called'); } });
    `, { keys: false })
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

  it('When the OR key is removed after a good run Then the existing payload becomes a single not_configured OR block', async () => {
    const mf3 = await createBundle(`
      import { createWorker } from './worker/index.ts';
      export default createWorker({ trendFetch: async () => { throw new Error('network must not be called'); } });
    `, { keys: false })
    try {
      const db3 = await mf3.getD1Database('DB')
      await applyMigrations(db3)
      const prior = {
        section: 'metrics',
        schemaVersion: 1,
        generatedAt: new Date(NOW).toISOString(),
        rule: 'aa-intelligence-and-or-usage-v1',
        sources: [{ id: 'openrouter-rankings', fetchedAt: new Date(NOW).toISOString(), status: 'ok' }],
        items: [],
        blocks: [
          { id: 'aa-intelligence', status: 'ok', asOf: '2026-11-17', version: '3.0', entries: [{ id: 'a/x', name: 'A X', creator: 'A', rank: 1, rankDelta: null, kind: 'steady', index: 90 }], attribution: 'AA' },
          { id: 'or-usage', status: 'ok', asOf: '2026-11-17T04:00:00Z', entries: [{ id: 'a/x', name: 'a/x', creator: 'a', rank: 1, rankDelta: null, kind: 'steady', share7d: 0.6 }], attribution: 'OR', license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, processed: true },
        ],
      }
      const text = JSON.stringify(prior)
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      await db3.prepare(
        'INSERT INTO trend_section (section, schema_version, generated_at, payload, payload_sha256) VALUES (?, ?, ?, ?, ?)',
      ).bind('metrics', 1, NOW, text, sha).run()
      const worker = await mf3.getWorker() as unknown as {
        scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
      }
      await worker.scheduled({ cron: METRICS_CRON, scheduledTime: NOW + 86_400_000 })
      const response = await mf3.dispatchFetch('http://localhost/pub/trend/metrics')
      expect(response.status).toBe(200)
      const body = await response.json() as { blocks: Array<{ id: string; status: string; entries: unknown[] }>; sources: unknown[] }
      expect(body.sources).toEqual([])
      expect(body.blocks.map((block) => [block.id, block.status])).toEqual([['or-usage', 'not_configured']])
      expect(body.blocks[0]?.entries).toEqual([])
    } finally {
      await mf3.dispose()
    }
  })
})
