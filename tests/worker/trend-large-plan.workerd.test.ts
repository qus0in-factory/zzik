import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { describe, expect, it } from 'vitest'
import { TREND_CRON } from '../../worker/domain/usage/export'

const root = fileURLToPath(new URL('../../', import.meta.url))
const now = Date.parse('2026-11-17T04:07:00Z')

describe('Given the actual trend cron and existing collector observations', () => {
  it('When the Go catalog has 61 models Then actual D1 stores all as one initial baseline', async () => {
    const bundle = await build({ stdin: { resolveDir: root, contents: `
      import { createWorker } from './worker/index.ts';
      const models = Array.from({ length: 61 }, (_, i) => ({ id: 'model-' + i, canonical_id: 'test/model-' + i, name: 'Model ' + i }));
      export default createWorker({ trendFetch: async (input) => String(input).includes('opencode.ai/inference/go/v1/models') ? new Response(JSON.stringify({ object: 'list', data: models }), { status: 200 }) : new Response('', { status: 500 }) });
    ` }, bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:sockets'], logLevel: 'silent' })
    const mf = new Miniflare({ workers: [{ config: { name: 'trend-large-plan', compatibilityDate: '2026-11-11', compatibilityFlags: ['nodejs_compat'], triggers: [{ type: 'scheduled', schedule: TREND_CRON }], env: { DB: { type: 'd1', id: 'trend-large-plan' } }, manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } } } }], log: new Log(LogLevel.NONE) })
    try {
      const db = await mf.getD1Database('DB')
      for (const name of ['0001_d1_storage.sql', '0002_trend.sql', '0003-trend-plan-observation.sql']) {
        const migration = readFileSync(root + 'worker/migrations/' + name, 'utf8')
        for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) await db.prepare(statement).run()
      }
      await db.prepare(`INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).bind('antigravity', 'test-model', 'Test', 'agy-cli', 'account', now, now).run()
      const worker = await mf.getWorker() as unknown as { scheduled(options: { cron: string; scheduledTime: number }): Promise<void> }
      await worker.scheduled({ cron: TREND_CRON, scheduledTime: now })
      const rows = await db.prepare('SELECT COUNT(*) AS count, SUM(baseline) AS baseline FROM trend_plan_observation WHERE plan = ?').bind('opencode-go').all<{ count: number; baseline: number }>()
      expect(rows.results[0]).toEqual({ count: 61, baseline: 61 })
    } finally { await mf.dispose() }
  }, 60_000)
})
