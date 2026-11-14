import { describe, expect, it } from 'vitest'
import { createDiscordAlerts } from '../../../../collector/infra/usage/discord-alerts.mjs'
import { formatAlertMessage } from '../../../../collector/domain/usage/alert-message.mjs'
const event = { provider: 'claude', id: 'five_hour', label: '5시간 한도', kind: 'level' as const, from: 'normal' as const, to: 'caution' as const, usedPercent: 75, elapsedPercent: 50, resetsAt: '2026-11-14T02:30:00Z', nowMs: Date.parse('2026-11-14T00:00:00Z') }
const url = 'https://discord.com/api/webhooks/123/synthetic-token'

describe('Given Discord alerts', () => {
  it('When multiple alerts occur Then uses the webhook default name with no mentions and a 5s deadline', async () => {
    const calls: { url: unknown; init: RequestInit }[] = []
    const sink = createDiscordAlerts({ webhookUrl: url, fetchImpl: (async (u, init) => { calls.push({ url: u, init: init! }); return new Response(null, { status: 204 }) }) as typeof fetch })
    expect(await sink.send([event, { ...event, provider: 'codex' }])).toMatchObject({ status: 'sent', count: 2 })
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0].init.body))
    expect(body).not.toHaveProperty('username')
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('75% / 예상 50%')
    expect(body.content).toContain('2시간 30분')
    expect(body.content).toContain('https://zzik.qus0in.dev')
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
    expect(sink.timeoutMs).toBe(5000)
  })
  it('When webhook is absent Then only logs metadata without sending', async () => {
    const logs: string[] = []
    const sink = createDiscordAlerts({ log: s => logs.push(s), fetchImpl: (async () => { throw Error('must not fetch') }) as typeof fetch })
    expect(await sink.send([event])).toMatchObject({ status: 'disabled' })
    expect(logs.join('')).toContain('count=1')
    expect(logs.join('')).not.toContain('75')
  })
  it('When force-disabled Then does not call a configured webhook', async () => {
    const sink = createDiscordAlerts({webhookUrl:url,enabled:false,fetchImpl:(async()=>{throw Error('must not fetch')}) as typeof fetch})
    expect(await sink.send([event])).toMatchObject({status:'disabled'})
  })
  it('When dry-running Then logs a value-free preview and never sends', async () => {
    const logs: string[] = []
    const sink = createDiscordAlerts({ webhookUrl: url, log: s => logs.push(s), fetchImpl: (async () => { throw Error('must not fetch') }) as typeof fetch })
    expect(await sink.send([event], { dryRun: true })).toMatchObject({ status: 'dry_run' })
    expect(logs.join('')).toContain('message=')
    for (const secret of [url, 'synthetic-token', '75', '50', '02:30']) expect(logs.join('')).not.toContain(secret)
  })
  it.each(['throw', 'http'] as const)('When delivery fails (%s) Then no exception or secret escapes', async mode => {
    const logs: string[] = []
    const sink = createDiscordAlerts({ webhookUrl: url, log: s => logs.push(s), fetchImpl: (async () => { if (mode === 'http') return new Response('private raw body', { status: 429 }); throw new Error(url) }) as typeof fetch })
    expect(await sink.send([event])).toMatchObject({ status: 'failed' })
    expect(logs.join('')).not.toContain(url)
    expect(logs.join('')).not.toContain('private raw body')
  })
  it('When the fetch stalls Then the real 5s signal cancels delivery without failing collection', async () => {
    const started = Date.now()
    const sink = createDiscordAlerts({ webhookUrl: url, fetchImpl: ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })) as typeof fetch })
    expect(await sink.send([event])).toMatchObject({ status: 'failed' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900)
    expect(Date.now() - started).toBeLessThan(7500)
  }, 8000)
  it('When there are no events Then no webhook request is made', async () => {
    const sink = createDiscordAlerts({ webhookUrl: url, fetchImpl: (async () => { throw Error('must not fetch') }) as typeof fetch })
    expect(await sink.send([])).toMatchObject({ status: 'empty' })
  })
  it('When many long labels exist Then the single message fits Discord content limits', () => {
    const text = formatAlertMessage(Array.from({ length: 100 }, () => ({ ...event, label: '한도'.repeat(1000) })))
    expect(text.length).toBeLessThanOrEqual(2000)
    expect(text).toContain('https://zzik.qus0in.dev')
    expect(text).toContain('생략')
  })
})
