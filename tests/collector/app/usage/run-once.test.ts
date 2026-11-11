import { describe, expect, it } from 'vitest'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { sha256Hex } from '../../../../collector/domain/usage/envelope.mjs'
import {
  COLLECTOR_NOW,
  USAGE_TOKEN,
  createFakeCollectorPorts,
  type FakeCredentialRead,
} from '../../../fakes/collector-ports'

const BODY = '{"five_hour":{"utilization":37,"resets_at":"2026-11-11T14:13:00.000Z"}}'

const futureExpiresAt = Date.parse('2026-11-11T18:00:00.000Z')

function fileCredential(expiresAt: number | null = futureExpiresAt, token = 'file-token-value'): FakeCredentialRead {
  return { source: 'file', token, expiresAt }
}

const okUsage = { ok: true, bodyText: BODY, httpStatus: 200, retryAfterSec: null } as const

/** runOnce는 .mjs라서 타입이 느슨하게 넘어간다. 가짜 포트의 구조는 테스트 계약으로 고정한다. */
type Ports = ReturnType<typeof createFakeCollectorPorts>

async function run(ports: Ports, options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return (await runOnce(ports as never, options as never)) as Record<string, unknown>
}

describe('Given a healthy run', () => {
  it('When usage succeeds then exactly one envelope is written to KV, state and log (Refs #6)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage(okUsage)

    const result = await run(ports)
    expect(result.exitCode).toBe(0)
    expect(ports.kv.calls).toBe(1)
    expect(ports.state.writeCount()).toBe(1)
    expect(ports.logger.entries).toHaveLength(1)

    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope).toMatchObject({
      schema: 1,
      provider: 'claude',
      status: 'ok',
      called: true,
      httpStatus: 200,
      rawText: BODY,
      rawOmitted: null,
      retryAt: null,
    })
    expect(envelope.fetchedAt).toBe(new Date(COLLECTOR_NOW).toISOString())
    expect(ports.logger.entries[0]).toMatchObject({ status: 'ok', called: true, httpStatus: 200, kvOk: true })
  })

  it('When run then the token never appears in KV, state or log records', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage(okUsage)
    await run(ports)

    const allRecords = [ports.state.snapshot(), ...ports.kv.writes, ...ports.logger.entries.map((e) => JSON.stringify(e))]
    for (const record of allRecords) {
      expect(String(record)).not.toContain(USAGE_TOKEN)
      expect(String(record)).not.toContain('sk-ant')
    }
    expect(ports.usage.tokens).toEqual(['file-token-value'])
  })

  it('When the usage call returns 429 without Retry-After then the gate waits one period (600s)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage({ ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: null })

    const result = await run(ports)
    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope.status).toBe('rate_limited')
    expect(envelope.retryAt).toBe(new Date(COLLECTOR_NOW + 600_000).toISOString())
    expect(envelope.rawText).toBeNull()
    const state = ports.state.snapshot() as { gate: { failCount: number } }
    expect(state.gate.failCount).toBe(1)
  })

  it('When the server asks 7200 seconds with Retry-After then it is not truncated to 3600 (V3)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage({ ok: false, kind: 'rate_limited', httpStatus: 429, retryAfterSec: 7200 })
    await run(ports)
    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope.retryAt).toBe(new Date(COLLECTOR_NOW + 7_200_000).toISOString())
  })

  it('When KV write fails then the exit code is non-zero and local state still wins', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage(okUsage)
    ports.kv.queueResult({ ok: false, httpStatus: 403, message: 'forbidden' })

    const result = await run(ports)
    expect(result.exitCode === 0).toBe(false)
    expect(ports.state.writeCount()).toBe(1)
    expect(ports.kv.calls).toBe(1)
    expect(ports.logger.entries[0]).toMatchObject({ kvOk: false, kvReason: 'forbidden' })
  })
})

describe('Given credential problems', () => {
  it('When the credential is expired then nothing is called and the status is token_expired', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential(COLLECTOR_NOW - 1000)])
    const result = await run(ports)
    expect(ports.usage.calls).toBe(0)
    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope.status).toBe('token_expired')
    expect(envelope.called).toBe(false)
    expect(envelope.retryAt).toBeNull()
    expect(envelope.tokenExpiresAt).toBe(new Date(COLLECTOR_NOW - 1000).toISOString())
  })

  it('When no credential can be read then the status is no_credentials and the exit code is 0 (D3)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([null])
    const result = await run(ports)
    expect(ports.usage.calls).toBe(0)
    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope.status).toBe('no_credentials')
    expect(envelope.called).toBe(false)
  })
})

describe('Given an auth_required denial and a token refresh', () => {
  it('When 401 happens then the gate blocks for an hour until the credential changes', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential(futureExpiresAt)])
    ports.usage.queueUsage({ ok: false, kind: 'auth_required', httpStatus: 401, retryAfterSec: null })
    await run(ports)

    // 같은 자격 증명, 10분 뒤: 게이트 때문에 호출하지 않는다.
    ports.clock.advance(600_000)
    ports.credentials.queueReads([fileCredential(futureExpiresAt)])
    await run(ports)
    expect(ports.usage.calls).toBe(1)
    const skippedEnvelope = JSON.parse(ports.kv.writes[1] as string) as Record<string, unknown>
    expect(skippedEnvelope.called).toBe(false)
    expect(skippedEnvelope.status).toBe('auth_required')
    expect(skippedEnvelope.retryAt).toBe(new Date(COLLECTOR_NOW + 3_600_000).toISOString())

    // expiresAt이 바뀐 자격 증명: 즉시 해제되어 다시 호출한다.
    ports.clock.advance(60_000)
    const refreshed = fileCredential(futureExpiresAt + 90_000, 'refreshed-token-value')
    ports.credentials.queueReads([refreshed])
    ports.usage.queueUsage(okUsage)
    await run(ports)
    expect(ports.usage.calls).toBe(2)
    const okEnvelope = JSON.parse(ports.kv.writes[2] as string) as Record<string, unknown>
    expect(okEnvelope.status).toBe('ok')
    expect(ports.kv.calls).toBe(3)

    // 토큰 갱신은 로그에 token_refreshed로만 남는다.
    expect(ports.logger.entries[2]).toMatchObject({ tokenRefreshed: true })
  })
})

describe('Given an already blocked gate from state', () => {
  it('When the gate blocks the run then it still writes one heartbeat envelope to KV', async () => {
    const previousEnvelope = {
      schema: 1,
      provider: 'claude',
      status: 'rate_limited',
      called: true,
      runAt: new Date(COLLECTOR_NOW - 600_000).toISOString(),
      fetchedAt: new Date(COLLECTOR_NOW - 3_600_000).toISOString(),
      httpStatus: 429,
      retryAt: new Date(COLLECTOR_NOW + 120_000).toISOString(),
      tokenExpiresAt: null,
      kvTokenExpiresAt: null,
      intervalSec: 300,
      collectorVersion: '0.2.0',
      rawText: BODY,
      rawOmitted: null,
    }
    const ports = createFakeCollectorPorts({
      schema: 1,
      previous: previousEnvelope,
      gate: { nextAllowedAt: COLLECTOR_NOW + 120_000, failReason: 'rate_limited', failCount: 1, authDeniedExpiresAt: null },
      lastRun: { status: 'rate_limited', tokenExpiresAt: null },
    })
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage(okUsage) // 호출되지 않아야 함

    const result = await run(ports)
    expect(ports.usage.calls).toBe(0)
    expect(result.exitCode).toBe(0)
    const envelope = JSON.parse(ports.kv.writes[0] as string) as Record<string, unknown>
    expect(envelope.called).toBe(false)
    expect(envelope.status).toBe('rate_limited')
    expect(envelope.rawText).toBe(BODY)
    expect(envelope.retryAt).toBe(new Date(COLLECTOR_NOW + 120_000).toISOString())
  })
})

describe('Given dry-run', () => {
  it('When dry running then nothing is written and the report carries status, keys and sha256 (V6)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential()])
    ports.usage.queueUsage(okUsage)

    const result = await run(ports, { dryRun: true })
    expect(result.exitCode).toBe(0)
    expect(ports.kv.calls).toBe(0)
    expect(ports.state.writeCount()).toBe(0)
    expect(ports.logger.entries).toHaveLength(0)
    const report = result.dryRunReport as { status: string; called: boolean; keys: string[]; sha256: string }
    expect(report.status).toBe('ok')
    expect(report.called).toBe(true)
    expect(report.keys).toEqual(['five_hour'])
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('When dry running with an expired credential then no network call happens (V6)', async () => {
    const ports = createFakeCollectorPorts()
    ports.credentials.queueReads([fileCredential(COLLECTOR_NOW - 1)])
    const result = await run(ports, { dryRun: true })
    expect(ports.usage.calls).toBe(0)
    const report = result.dryRunReport as { status: string; called: boolean }
    expect(report.status).toBe('token_expired')
    expect(report.called).toBe(false)
  })
})

describe('Given the log transition fields', () => {
  it('When the status changes and the token is refreshed then the log entry records both', async () => {
    const ports = createFakeCollectorPorts({
      schema: 1,
      previous: null,
      gate: { nextAllowedAt: null, failReason: null, failCount: 0, authDeniedExpiresAt: null },
      lastRun: { status: 'token_expired', tokenExpiresAt: futureExpiresAt },
    })
    ports.credentials.queueReads([fileCredential(futureExpiresAt + 90_000)])
    ports.usage.queueUsage(okUsage)
    await run(ports)
    expect(ports.logger.entries[0]).toMatchObject({
      status: 'ok',
      transition: 'token_expired→ok',
      tokenRefreshed: true,
    })
  })
})

describe('Given the raw body digest helper', () => {
  it('When hashing body text then the digest is deterministic (V6 dry-run sha256)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
