import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
import { describe, expect, it } from 'vitest'
import { TREND_CRON } from '../../worker/domain/usage/export'

const root = fileURLToPath(new URL('../../', import.meta.url))
const now = Date.parse('2026-11-17T04:07:00Z')

describe('Given the actual trend cron and existing collector observations', () => {
  it('When every public source fails Then it records failures and still builds a stale plan-models section', async () => {
    const bundle = await build({ stdin: { resolveDir: root, contents: `
      import { createWorker } from './worker/index.ts';
      export default createWorker({ trendFetch: async () => new Response('', { status: 500 }) });
    ` }, bundle: true, write: false, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:sockets'], logLevel: 'silent' })
    const mf = new Miniflare({ workers: [{ config: { name: 'trend-failed-sources', compatibilityDate: '2026-11-11', compatibilityFlags: ['nodejs_compat'], triggers: [{ type: 'scheduled', schedule: TREND_CRON }], env: { DB: { type: 'd1', id: 'trend-failed-sources' } }, manifest: { mainModule: 'probe.mjs', modules: { 'probe.mjs': { type: 'esm', contents: bundle.outputFiles[0]!.text } } } } }], log: new Log(LogLevel.NONE) })
    try {
      const db = await mf.getD1Database('DB')
      for (const name of ['0001_d1_storage.sql', '0002_trend.sql', '0003-trend-plan-observation.sql']) {
        const migration = readFileSync(root + 'worker/migrations/' + name, 'utf8')
        for (const statement of migration.replace(/^--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean)) await db.prepare(statement).run()
      }
      await db.prepare(`INSERT INTO trend_plan_observation (plan, model_id, display_name, source, confidence, first_seen_at, last_seen_at, baseline) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).bind('antigravity', 'test-model', 'Test', 'agy-cli', 'account', now, now).run()
      const worker = await mf.getWorker() as unknown as { scheduled(options: { cron: string; scheduledTime: number }): Promise<void> }
      await worker.scheduled({ cron: TREND_CRON, scheduledTime: now })
      const states = await db.prepare('SELECT source, ok, http_status FROM trend_source_state ORDER BY source').all<{ source: string; ok: number; http_status: number }>()
      expect(states.results).toHaveLength(5)
      expect(states.results.every((row: { ok: number; http_status: number }) => row.ok === 0 && row.http_status === 500)).toBe(true)
      const sections = await db.prepare('SELECT section, generated_at, payload FROM trend_section ORDER BY section').all<{ section: string; generated_at: number; payload: string }>()
      expect(sections.results.map((row: { section: string }) => row.section)).toEqual(['plan-models'])
      expect(sections.results.every((row: { generated_at: number }) => row.generated_at === now)).toBe(true)
      expect(sections.results.every((row: { payload: string }) => JSON.parse(row.payload).sources.every((source: { status: string }) => source.status === 'stale'))).toBe(true)
    } finally { await mf.dispose() }
  }, 60_000)
})
