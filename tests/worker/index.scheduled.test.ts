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
    expect(entries).toEqual(['trend_refresh:start', 'trend_refresh_failed:unexpected:TypeError'])
    expect(entries.join(' ')).not.toContain('sensitive')
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
