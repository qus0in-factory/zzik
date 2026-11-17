import { builtinModules } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TREND_CRON } from '../../worker/domain/usage/export'

const migration1 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0001_d1_storage.sql', import.meta.url)), 'utf8')
const migration2 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0002_trend.sql', import.meta.url)), 'utf8')
const migration3 = readFileSync(fileURLToPath(new URL('../../worker/migrations/0003-trend-plan-observation.sql', import.meta.url)), 'utf8')
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
  'ollama-cloud': {
    id: 'ollama-cloud',
    models: {
      'qwen4-max': {
        id: 'qwen4-max',
        name: 'Qwen4 Max',
        release_date: '2026-11-05',
        canonical_model_id: 'qwen/qwen4-max',
        open_weights: true,
      },
    },
  },
}
const zen = {
  object: 'list',
  data: [{
    id: 'hy4-flash-free',
    name: 'Hy4 Flash Free',
    canonical_id: 'tencent/hy4-flash',
    release_date: '2026-11-16',
    open_weights: false,
    cost: { text: { input: { price: 0 }, output: { price: 0 } } },
  }],
}
const openrouter = {
  data: [{
    id: 'inclusionai/ling-3.2-flash:free',
    name: 'Ling 3.2 Flash (free)',
    created: 1_794_528_000,
    pricing: { prompt: '0', completion: '0' },
    hugging_face_id: null,
    expiration_date: null,
  }],
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
          const models = ${JSON.stringify(models)};
          const zen = ${JSON.stringify(zen)};
          const openrouter = ${JSON.stringify(openrouter)};
          const json = (body, etag) => new Response(JSON.stringify(body), {
            status: 200,
            headers: etag === undefined ? {} : { etag, 'content-type': 'application/json' },
          });
          const fakeFetch = async (input, init) => {
            const url = String(input);
            const inm = new Headers(init?.headers).get('If-None-Match');
            if (url.includes('models.dev')) {
              if (inm === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
              return json(models, '"v1"');
            }
            if (url.includes('opencode.ai/inference/go/v1/models')) return json({ object: 'list', data: [{ id: 'deepseek-v4.1-flash', canonical_id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017' }, ...zen.data] });
            if (url.includes('ollama.com/api/tags')) return json({ models: [{ name: 'glm-5.3', size: 0 }] });
            if (url.includes('opencode.ai')) return json(zen);
            if (url.includes('openrouter.ai')) return json(openrouter);
            return new Response('not found', { status: 404 });
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
    for (const migration of [migration1, migration2, migration3]) {
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) {
        await db.prepare(statement).run()
      }
    }
    const seed = async (plan: string, modelId: string, displayName: string, source: string) => {
      await db.prepare(
        `INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline)
         VALUES (?, ?, ?, ?, 'catalog', ?, ?, 0)`,
      ).bind(plan, modelId, displayName, source, NOW - 86_400_000, NOW - 3_600_000).run()
    }
    await seed('opencode-go', 'deepseek/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash 1017', 'go-models')
    await seed('ollama-cloud', 'glm-5.3', 'glm-5.3', 'ollama-tags')
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the trend cron fetches all sources Then writes both sections and /pub serves them with ETag and cache', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW })

    const sections = await db.prepare('SELECT section, payload, payload_sha256 AS sha, generated_at AS at FROM trend_section').all<{ section: string; payload: string; sha: string; at: number }>()
    const sectionRows = sections.results as Array<{ section: string; payload: string; sha: string; at: number }>
    expect(sectionRows.map((row) => row.section).sort()).toEqual(['free-models', 'new-models', 'plan-models'])
    expect(sectionRows.every((row) => /^[0-9a-f]{64}$/.test(row.sha) && row.at === NOW)).toBe(true)

    const seen = await db.prepare('SELECT canonical_id AS id FROM trend_model_seen ORDER BY canonical_id').all<{ id: string }>()
    expect(seen.results).toEqual([])
    const states = await db.prepare('SELECT source, etag, ok, http_status AS status FROM trend_source_state ORDER BY source').all<{ source: string; etag: string | null; ok: number; status: number }>()
    expect(states.results).toEqual([
      { source: 'go-models', etag: null, ok: 1, status: 200 },
      { source: 'models.dev', etag: '"v1"', ok: 1, status: 200 },
      { source: 'openrouter', etag: null, ok: 1, status: 200 },
    ])

    const response = await mf.dispatchFetch('http://localhost/pub/trend/new-models')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    expect(response.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    const body = await response.json() as { section: string; items: Array<{ id: string; providers: string[] }> }
    expect(body.section).toBe('new-models')
    expect(body.items).toEqual([
      expect.objectContaining({ id: 'inclusionai/ling-3.2-flash', registeredIn: ['openrouter'] }),
    ])
    expect(JSON.stringify(body)).not.toContain('"aa"')

    const free = await mf.dispatchFetch('http://localhost/pub/trend/free-models')
    expect(free.status).toBe(200)
    expect(free.headers.get('ETag')).toMatch(/^"[0-9a-f]{64}"$/)
    const freeText = await free.text()
    expect(freeText).not.toContain('sourceItems')
    expect(freeText).not.toContain('extra')
    const freeBody = JSON.parse(freeText) as { items: Array<{ id: string; freeKind: string; price: unknown; recentlyAdded?: boolean }>; sources: Array<{ id: string; status: string }> }
    expect(freeBody.items).toEqual([
      expect.objectContaining({ id: 'tencent/hy4-flash', freeKind: 'opencode-go', price: { input: 0, output: 0 }, recentlyAdded: true }),
    ])
    expect(freeBody.sources.map((source) => source.id)).toEqual(['go-models'])

    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    expect(index.status).toBe(200)
    const indexBody = await index.json() as { sections: Array<{ id: string; count: number; status: string }> }
    expect(indexBody.sections).toEqual(expect.arrayContaining([
      { id: 'new-models', count: 1, generatedAt: new Date(NOW).toISOString(), checkedAt: new Date(NOW).toISOString(), status: 'ok' },
      { id: 'free-models', count: 1, generatedAt: new Date(NOW).toISOString(), checkedAt: new Date(NOW).toISOString(), status: 'ok' },
    ]))

    const notModified = await mf.dispatchFetch('http://localhost/pub/trend/new-models', { headers: { 'If-None-Match': response.headers.get('ETag')! } })
    expect(notModified.status).toBe(304)
    expect(await notModified.text()).toBe('')
    const freeNotModified = await mf.dispatchFetch('http://localhost/pub/trend/free-models', { headers: { 'If-None-Match': free.headers.get('ETag')! } })
    expect(freeNotModified.status).toBe(304)
  })

  it('When the next trend cron gets 304 from models.dev Then keeps section hashes and records each source state', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    const before = await db.prepare('SELECT section, payload_sha256 AS sha FROM trend_section ORDER BY section').all<{ section: string; sha: string }>()
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 7_200_000 })
    const after = await db.prepare('SELECT section, payload_sha256 AS sha FROM trend_section ORDER BY section').all<{ section: string; sha: string }>()
    expect(after.results).toEqual(before.results)
    const state = await db.prepare('SELECT http_status AS status FROM trend_source_state WHERE source = ?').bind('models.dev').all<{ status: number }>()
    expect(state.results[0]?.status).toBe(304)
  })

  it('When 8 days pass and models.dev still returns 304 Then re-evaluates both sections at the new time', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 8 * 86_400_000 })

    const response = await mf.dispatchFetch('http://localhost/pub/trend/new-models')
    expect(response.status).toBe(200)
    const body = await response.json() as { items: unknown[]; generatedAt: string }
    expect(body.items).toEqual([])
    expect(body.generatedAt).toBe(new Date(NOW + 8 * 86_400_000).toISOString())

    // free-models는 Zen 무료 목록을 유지한다.
    const free = await mf.dispatchFetch('http://localhost/pub/trend/free-models')
    const freeBody = await free.json() as { items: unknown[] }
    expect(freeBody.items).toHaveLength(1)

    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    const indexBody = await index.json() as { sections: Array<{ id: string; count: number; status: string }> }
    expect(indexBody.sections).toEqual(expect.arrayContaining([
      { id: 'new-models', count: 0, generatedAt: new Date(NOW + 8 * 86_400_000).toISOString(), checkedAt: new Date(NOW + 8 * 86_400_000).toISOString(), status: 'ok' },
      expect.objectContaining({ id: 'free-models', count: 1, checkedAt: new Date(NOW + 8 * 86_400_000).toISOString(), status: 'ok' }),
    ]))
  })
})
