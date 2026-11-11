/**
 * 수집기(app·infra)용 가짜 포트. 전역 fetch·Date를 바꿔치기하지 않고
 * 결과를 인자로 주입한다(D12).
 */

export const COLLECTOR_NOW = Date.parse('2026-11-11T12:00:00.000Z')
/** 가짜 토큰 값. 어떤 기록에도 남지 않는지 확인하는 용도로만 쓴다. */
export const USAGE_TOKEN = 'sk-ant-secret-token-value'

export interface FakeCredentialRead {
  source: string
  token: string
  expiresAt: number | null
}

export type FakeUsageResult =
  | { ok: true; bodyText: string; httpStatus: number | null; retryAfterSec: number | null }
  | { ok: false; kind: 'rate_limited' | 'auth_required' | 'upstream_error' | 'network_error'; httpStatus: number | null; retryAfterSec: number | null }

export type FakeKvResult = { ok: true } | { ok: false; httpStatus: number | null; message: string }

export function createFakeCollectorPorts(initialState?: unknown): {
  clock: { now(): number; advance(ms: number): void; current(): number }
  credentials: {
    readAll(): Promise<Array<FakeCredentialRead | null>>
    queueReads(reads: Array<FakeCredentialRead | null>): void
  }
  usage: {
    calls: number
    tokens: string[]
    fetchUsage(token: string): Promise<FakeUsageResult>
    queueUsage(result: FakeUsageResult): void
  }
  kv: {
    calls: number
    writes: string[]
    write(value: string): Promise<FakeKvResult>
    queueResult(result: FakeKvResult): void
  }
  state: {
    read(): Promise<unknown>
    write(state: unknown): Promise<void>
    writeCount(): number
    snapshot(): unknown
  }
  logger: {
    entries: Record<string, unknown>[]
    write(entry: Record<string, unknown>): Promise<void>
  }
} {
  let nowMs = COLLECTOR_NOW
  let credentialQueue: Array<Array<FakeCredentialRead | null>> = []
  let usageQueue: FakeUsageResult[] = []
  let kvQueue: FakeKvResult[] = []
  let storedState: unknown = initialState
  const stateWrites: unknown[] = []

  const ports = {
    clock: {
      now: (): number => nowMs,
      advance(ms: number): void {
        nowMs += ms
      },
      current: (): number => nowMs,
    },
    credentials: {
      async readAll(): Promise<Array<FakeCredentialRead | null>> {
        return credentialQueue.shift() ?? []
      },
      queueReads(reads: Array<FakeCredentialRead | null>): void {
        credentialQueue.push(reads)
      },
    },
    usage: {
      calls: 0,
      tokens: [] as string[],
      async fetchUsage(token: string): Promise<FakeUsageResult> {
        ports.usage.calls += 1
        ports.usage.tokens.push(token)
        return usageQueue.shift() ?? { ok: false, kind: 'network_error', httpStatus: null, retryAfterSec: null }
      },
      queueUsage(result: FakeUsageResult): void {
        usageQueue.push(result)
      },
    },
    kv: {
      calls: 0,
      writes: [] as string[],
      async write(value: string): Promise<FakeKvResult> {
        ports.kv.calls += 1
        ports.kv.writes.push(value)
        return kvQueue.shift() ?? { ok: true }
      },
      queueResult(result: FakeKvResult): void {
        kvQueue.push(result)
      },
    },
    state: {
      async read(): Promise<unknown> {
        return storedState
      },
      async write(state: unknown): Promise<void> {
        stateWrites.push(state)
        storedState = state
      },
      writeCount: (): number => stateWrites.length,
      snapshot: (): unknown => storedState,
    },
    logger: {
      entries: [] as Record<string, unknown>[],
      async write(entry: Record<string, unknown>): Promise<void> {
        ports.logger.entries.push(entry)
      },
    },
  }
  return ports
}
