import { describe, expect, it } from 'vitest'
import { createWorker } from '../../worker/index'
import type { Env } from '../../worker/infra/env'
import { EXPORT_CRON, TREND_CRON } from '../../worker/domain/usage/export'
import type { ExportEventRow } from '../../worker/domain/usage/export'
import { FakeExportSink, FakeExportSource } from '../fakes/export-ports'

const NOW = Date.parse('2026-11-16T03:00:00.000Z')
const env: Env = {
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
  ALLOWED_EMAIL: 'owner@example.com',
  ASSETS: { async fetch() { return new Response('SPA') } },
}
const verify = () => ({ async verify() { return { ok: true as const, claims: { email: 'owner@example.com' } } } })
const event: ExportEventRow = {
  id: '10',
  provider: 'codex',
  runAtMs: 1_000,
  status: 'ok',
  rawSha256: null,
  envelope: JSON.stringify({ schema: 1, provider: 'codex', status: 'ok' }),
  operationId: null,
}

describe('Given the Worker scheduled entrypoint', () => {
  it('When the trend binding is absent Then the scheduled attempt records the reason', async () => {
    const entries: string[] = []
    const worker = createWorker({ logTrend: (message) => entries.push(message) })
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW }, env)
    expect(entries).toEqual(['trend_refresh:start', 'trend_refresh_failed:missing_db'])
  })

  it('When the trend database fails Then logs only a safe exception class', async () => {
    const entries: string[] = []
    const db = { prepare() { throw new TypeError('sensitive error detail') } }
    const worker = createWorker({ logTrend: (message) => entries.push(message) })
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW }, { ...env, DB: db })
    expect(entries[0]).toBe('trend_refresh:start')
    expect(entries.at(-1)).toContain('TypeError')
    expect(entries.join(' ')).not.toContain('sensitive')
  })

  it('When D1 fails in fetchSource (stage 1) Then plan-models (stage 4) still runs and logs completion', async () => {
    const entries: string[] = []
    const seenSql: string[] = []
    const db = {
      prepare(sql: string) {
        seenSql.push(sql)
        const stmt = {
          bind(..._params: unknown[]) { return stmt },
          async all() {
            if (sql.includes('trend_source_state')) throw new Error('d1_source_state_down')
            return { success: true, results: [] }
          },
          async run() {
            if (sql.includes('trend_source_state')) throw new Error('d1_source_state_down')
            return { success: true, results: [] }
          },
        }
        return stmt
      },
      async batch() { return [] },
    }
    const fetchStub = async () => new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })
    const worker = createWorker({ logTrend: (message) => entries.push(message), trendFetch: fetchStub })
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW }, { ...env, DB: db })
    expect(seenSql.some((s) => s.includes('trend_plan_observation'))).toBe(true)
    expect(entries.at(-1)).toMatch(/^trend_refresh:complete /)
  })

  it('When new-models write throws (stage 2) Then free-models (stage 3) and plan-models (stage 4) still run and section:new-models stays unwritten', async () => {
    const entries: string[] = []
    const writtenSections: string[] = []
    const writtenStates: string[] = []
    const db = {
      prepare(sql: string) {
        const makeStmt = (bound: unknown[] = []) => ({
          bind(...params: unknown[]) { return makeStmt(params) },
          async all() { return { success: true, results: [] } },
          async run() {
            if (sql.includes('INSERT INTO trend_section')) {
              if (bound[0] === 'new-models') throw new Error('trend_section_too_large')
              writtenSections.push(String(bound[0]))
            }
            if (sql.includes('INSERT INTO trend_source_state')) {
              writtenStates.push(String(bound[0]))
            }
            return { success: true, results: [] }
          },
        })
        return makeStmt()
      },
      async batch() { return [] },
    }
    const fetchStub = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('models.dev')) return new Response(JSON.stringify({}), { status: 200 })
      if (url.includes('openrouter.ai')) {
        return new Response(JSON.stringify({ data: [{ id: 'a/b', name: 'B', created: Math.floor(NOW / 1000), pricing: { prompt: '0', completion: '0' } }] }), { status: 200 })
      }
      if (url.includes('opencode.ai/inference/go/v1/models')) {
        return new Response(JSON.stringify({ object: 'list', data: [{ id: 'hy4-flash-free', name: 'Hy4 flash Free', cost: { text: { input: { price: 0 }, output: { price: 0 } } } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 })
    }
    const worker = createWorker({ logTrend: (message) => entries.push(message), trendFetch: fetchStub })
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW }, { ...env, DB: db })
    expect(writtenSections).toContain('free-models')
    expect(writtenSections).toContain('plan-models')
    expect(writtenStates).not.toContain('section:new-models')
    expect(writtenStates).toContain('section:free-models')
    expect(writtenStates).toContain('section:plan-models')
    expect(entries.at(-1)).toContain('new=error:Error')
    expect(entries.at(-1)).toContain('free=written')
  })

  it.each([
    ['free-models', /free=error:Error/],
    ['plan-models', /plan=error:Error/],
  ] as const)('When %s write throws Then logs %s token', async (failingSection, expectedToken) => {
    const entries: string[] = []
    const db = {
      prepare(sql: string) {
        const makeStmt = (bound: unknown[] = []) => ({
          bind(...params: unknown[]) { return makeStmt(params) },
          async all() { return { success: true, results: [] } },
          async run() {
            if (sql.includes('INSERT INTO trend_section') && bound[0] === failingSection) {
              throw new Error('forced_section_error')
            }
            return { success: true, results: [] }
          },
        })
        return makeStmt()
      },
      async batch() { return [] },
    }
    const fetchStub = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('models.dev')) return new Response(JSON.stringify({}), { status: 200 })
      if (url.includes('openrouter.ai')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (url.includes('opencode.ai/inference/go/v1/models')) {
        return new Response(JSON.stringify({ object: 'list', data: [{ id: 'hy4-flash-free', name: 'Hy4 flash Free', cost: { text: { input: { price: 0 }, output: { price: 0 } } } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ models: [] }), { status: 200 })
    }
    const worker = createWorker({ logTrend: (message) => entries.push(message), trendFetch: fetchStub })
    await worker.scheduled({ cron: TREND_CRON, scheduledTime: NOW }, { ...env, DB: db })
    expect(entries.at(-1)).toMatch(expectedToken)
  })

  it('When the export cron runs with injected bindings Then it writes and logs without touching fetch', async () => {
    const source = new FakeExportSource()
    source.events = [event]
    const sink = new FakeExportSink()
    const worker = createWorker({ createVerifier: verify, exportSource: () => source, exportSink: () => sink })

    await worker.scheduled({ cron: EXPORT_CRON, scheduledTime: NOW }, env, { waitUntil() {} })

    expect(sink.puts).toHaveLength(1)
    expect(source.logs).toHaveLength(1)
    expect(source.logs[0]).toMatchObject({ ok: 1, eventHighWaterId: '10' })
  })

  it('When D1 or R2 bindings are absent Then the scheduled run finishes as a safe no-op', async () => {
    const worker = createWorker({ createVerifier: verify })
    await expect(worker.scheduled({ cron: EXPORT_CRON, scheduledTime: NOW }, env, { waitUntil() {} })).resolves.toBeUndefined()
  })

  it('When the bucket cron or an unknown cron runs Then the export patch does not write', async () => {
    const source = new FakeExportSource()
    const sink = new FakeExportSink()
    const worker = createWorker({ createVerifier: verify, exportSource: () => source, exportSink: () => sink })
    await worker.scheduled({ cron: '*/15 * * * *', scheduledTime: NOW }, env, { waitUntil() {} })
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: NOW }, env, { waitUntil() {} })
    expect(sink.puts).toHaveLength(0)
    expect(source.logs).toHaveLength(0)
  })

  it('When export data generation is malformed Then the scheduled run is a safe no-op', async () => {
    const source = new FakeExportSource()
    const sink = new FakeExportSink()
    const worker = createWorker({ createVerifier: verify, exportSource: () => source, exportSink: () => sink })
    await worker.scheduled({ cron: EXPORT_CRON, scheduledTime: NOW }, { ...env, USAGE_DATA_GENERATION: 'nope' }, { waitUntil() {} })
    expect(sink.puts).toHaveLength(0)
  })
})
