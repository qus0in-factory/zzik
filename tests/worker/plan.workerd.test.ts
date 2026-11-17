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
const NOW = Date.parse('2026-11-17T05:00:00.000Z')
const DAY = 86_400_000
const catalog = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-fable-5': {
        id: 'claude-fable-5',
        name: 'Claude Fable 5',
        release_date: '2026-11-09',
        canonical_model_id: 'anthropic/claude-fable-5',
        open_weights: false,
      },
    },
  },
}

describe('Given the actual Worker trend cron with plan-models in workerd', () => {
  let mf: Miniflare
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>

  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
        contents: `
          import { createWorker } from './worker/index.ts';
          const catalog = ${JSON.stringify(catalog)};
          let goCalls = 0;
          const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
          const fakeFetch = async (input) => {
            const url = String(input);
            if (url.includes('models.dev')) return json(catalog);
            if (url.includes('opencode.ai/inference/go/v1/models')) {
              goCalls += 1;
              // free-models와 plan-models가 각각 한 번씩 호출하므로 cron 회차 = ceil(goCalls / 2).
              const phase = Math.ceil(goCalls / 2);
              if (phase === 3) return new Response('', { status: 500 });
              const data = [{ id: 'deepseek-v4.1-flash', canonical_id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017' }];
              if (phase >= 2) data.push({ id: 'new-go-model', canonical_id: 'new/go-model', name: 'New Go Model' });
              return json({ object: 'list', data });
            }
            if (url.includes('ollama.com/api/tags')) return json({ models: [{ name: 'glm-5.3', size: 0 }] });
            if (url.includes('opencode.ai/zen/v1/models')) return json({ object: 'list', data: [] });
            if (url.includes('openrouter.ai/api/v1/models')) return json({ data: [] });
            return new Response('not found', { status: 404 });
          };
          export default createWorker({ trendFetch: fakeFetch });
        `,
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
    mf = new Miniflare({
      workers: [{
        config: {
          name: 'zzik-plan-test',
          compatibilityDate: '2026-11-11',
          compatibilityFlags: ['nodejs_compat'],
          triggers: [{ type: 'scheduled', schedule: TREND_CRON }],
          env: { DB: { type: 'd1', id: 'zzik-plan-test' } },
          manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } },
        },
      }],
      log: new Log(LogLevel.NONE),
    })
    db = await mf.getD1Database('DB')
    for (const migration of [migration1, migration2, migration3]) {
      for (const statement of migration.replace(/^--.*$/gm, '').split(';').map((sql) => sql.trim()).filter(Boolean)) {
        await db.prepare(statement).run()
      }
    }
    await db.prepare(
      `INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).bind('antigravity', 'gemini-4-argon', 'Gemini 4 Argon', 'agy-cli', 'account', NOW - 2 * DAY, NOW).run()
    await db.prepare(
      `INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    ).bind('claude-max', 'claude-display:claude fable 5', 'Claude Fable 5', 'usage-keys', 'partial', NOW - DAY, NOW).run()
  }, 60_000)

  afterAll(async () => { await mf.dispose() })

  it('When the first cron runs Then public sources become baseline and collector observations are grouped', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW })

    const goRows = await db.prepare('SELECT model_id AS id, baseline, first_seen_at AS seen FROM trend_plan_observation WHERE plan = ? ORDER BY model_id').bind('opencode-go').all<{ id: string; baseline: number; seen: number }>()
    expect(goRows.results).toEqual([{ id: 'deepseek/deepseek-v4.1-flash-1017', baseline: 1, seen: NOW }])
    const ollamaRows = await db.prepare('SELECT baseline FROM trend_plan_observation WHERE plan = ?').bind('ollama-cloud').all<{ baseline: number }>()
    expect(ollamaRows.results).toEqual([{ baseline: 1 }])

    const response = await mf.dispatchFetch('http://localhost/pub/trend/plan-models')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600')
    const etag = response.headers.get('ETag')
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/)
    const text = await response.text()
    expect(text).not.toContain('extra')
    expect(text).not.toContain('rawIds')
    const body = JSON.parse(text) as { plans: Array<{ id: string; status: string; note?: string; items: Array<Record<string, unknown>> }> }
    expect(body.plans.map((plan) => plan.id)).toEqual(['antigravity', 'claude-max', 'grok', 'codex'])
    expect(body.plans.find((plan) => plan.id === 'claude-max')).toMatchObject({ status: 'partial', note: 'partial_judgement' })
    expect(body.plans.find((plan) => plan.id === 'claude-max')?.items[0]).toMatchObject({
      id: 'anthropic/claude-fable-5', name: 'Claude Fable 5', creator: 'anthropic',
      releaseDate: '2026-11-09', matched: true, confidence: 'partial',
    })
    expect(body.plans.find((plan) => plan.id === 'grok')).toMatchObject({ status: 'unavailable', note: 'unverified' })
    expect(body.plans.find((plan) => plan.id === 'codex')).toMatchObject({ status: 'unavailable', note: 'not_implemented' })

    const notModified = await mf.dispatchFetch('http://localhost/pub/trend/plan-models', { headers: { 'If-None-Match': etag! } })
    expect(notModified.status).toBe(304)
  })

  it('When a later cron sees a new Go model Then only that model is non-baseline and appears', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 7_200_000 })

    const rows = await db.prepare('SELECT model_id AS id, baseline, first_seen_at AS seen FROM trend_plan_observation WHERE plan = ? ORDER BY model_id').bind('opencode-go').all<{ id: string; baseline: number; seen: number }>()
    expect(rows.results).toEqual([
      { id: 'deepseek/deepseek-v4.1-flash-1017', baseline: 1, seen: NOW },
      { id: 'new/go-model', baseline: 0, seen: NOW + 7_200_000 },
    ])

    const response = await mf.dispatchFetch('http://localhost/pub/trend/plan-models')
    const body = await response.json() as { plans: Array<{ id: string; status: string; items: Array<{ id: string }> }> }
    const go = body.plans.find((plan) => plan.id === 'opencode-go')
    expect(go).toMatchObject({ status: 'ok' })
    expect(go?.items.map((item) => item.id)).toEqual(['new/go-model'])
    expect(body.plans.find((plan) => plan.id === 'claude-max')?.items).toHaveLength(1)
  })

  it('When Go fails later Then keeps its prior item and marks only that group partial', async () => {
    const worker = await mf.getWorker() as unknown as {
      scheduled(options: { cron: string; scheduledTime: number }): Promise<void>
    }
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW + 4 * 3_600_000 })

    const response = await mf.dispatchFetch('http://localhost/pub/trend/plan-models')
    const body = await response.json() as {
      plans: Array<{ id: string; status: string; note?: string; items: Array<{ id: string }> }>
      sources: Array<{ id: string; status: string }>
    }
    expect(body.plans.find((plan) => plan.id === 'opencode-go')).toMatchObject({ status: 'partial', note: 'source_failed' })
    expect(body.plans.find((plan) => plan.id === 'opencode-go')?.items.map((item) => item.id)).toEqual(['new/go-model'])
    expect(body.plans.find((plan) => plan.id === 'claude-max')?.items).toHaveLength(1)
    expect(body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'go-models', status: 'stale' }),
      expect.objectContaining({ id: 'ollama-tags', status: 'ok' }),
    ]))

    const index = await mf.dispatchFetch('http://localhost/pub/trend')
    const indexBody = await index.json() as { sections: Array<{ id: string; count: number; status: string }> }
    expect(indexBody.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'plan-models', count: 0, status: 'stale' }),
    ]))
  })
})
