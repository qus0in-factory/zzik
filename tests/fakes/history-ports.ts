import type { HistoryCacheStore, KeyValueStorage, UsageHistoryGateway, UsageHistoryGatewayFailure } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { USAGE_HISTORY_SCAN_VERSION } from '../../shared/usage-history-contract'
import type { UsageHistoryPage, UsageHistoryQuery, UsageHistorySample, UsageHistorySummaryEntry } from '../../shared/usage-history-contract'

const cursorOf = (sample: UsageHistorySample): string => `${sample.runAt}_${sample.id}`
const compare = (a: string, b: string): number => {
  const [ar = '', ai = ''] = a.split('_')
  const [br = '', bi = ''] = b.split('_')
  if (ar !== br) return ar < br ? -1 : 1
  return ai.length !== bi.length ? ai.length - bi.length : ai < bi ? -1 : ai > bi ? 1 : 0
}

/** 서버 계약(ADR 0.7 4.2절)과 같은 규칙으로 쪽을 만드는 가짜 서버. 이벤트는 (runAt, id) 오름차순이다. */
export function createFakeHistoryServer(provider: UsageProvider, events: UsageHistorySample[]) {
  const sorted = [...events].sort((a, b) => compare(cursorOf(a), cursorOf(b)))
  return {
    events: sorted,
    page(query: UsageHistoryQuery): UsageHistoryPage {
      const matches = sorted.filter(
        (sample) =>
          (query.from === undefined || sample.runAt >= query.from) &&
          (query.until === undefined || sample.runAt < query.until) &&
          (query.after === undefined || compare(cursorOf(sample), query.after) > 0),
      )
      const samples = matches.slice(0, query.limit)
      const anchor = query.anchor === true && query.from !== undefined ? ([...sorted].reverse().find((sample) => sample.status === 'ok' && sample.runAt < (query.from as string)) ?? null) : null
      const last = samples.at(-1)
      return { provider, scanVersion: USAGE_HISTORY_SCAN_VERSION, samples, anchor, nextCursor: last !== undefined ? cursorOf(last) : (query.after ?? null), hasMore: samples.length === query.limit }
    },
    /** I1 검사용: 레코드가 가져야 할 표본 = 서버의 [coveredFrom, cursor] 구간 이벤트 */
    expectedSamples(coveredFrom: string | null, cursor: string | null): UsageHistorySample[] {
      if (coveredFrom === null || cursor === null) return []
      return sorted.filter((sample) => sample.runAt >= coveredFrom && compare(cursorOf(sample), cursor) <= 0)
    },
  }
}

export interface FakeHistoryGateway extends UsageHistoryGateway {
  queries: UsageHistoryQuery[]
  summaryCalls: number
  /** n번째(1부터) fetchSamples 호출을 실패시킨다. */
  failAt: Set<number>
  failure: UsageHistoryGatewayFailure
  /** 호출 직전 훅(동시 실행 시나리오용) */
  onBeforeFetch?: (callNumber: number) => void | Promise<void>
  /** 다음 응답의 scanVersion을 바꿔 불일치를 흉내 낸다 */
  mismatchAt: Set<number>
  summary: UsageHistorySummaryEntry[]
}

export function createFakeHistoryGateway(servers: Partial<Record<UsageProvider, ReturnType<typeof createFakeHistoryServer>>>): FakeHistoryGateway {
  const gateway: FakeHistoryGateway = {
    queries: [],
    summaryCalls: 0,
    failAt: new Set(),
    mismatchAt: new Set(),
    failure: { ok: false, reason: 'network_error', message: null },
    summary: [],
    async fetchSummary() {
      gateway.summaryCalls += 1
      return { ok: true, summary: gateway.summary }
    },
    async fetchSamples(provider, query) {
      gateway.queries.push(query)
      const call = gateway.queries.length
      await gateway.onBeforeFetch?.(call)
      if (gateway.failAt.has(call)) return gateway.failure
      if (gateway.mismatchAt.has(call)) return { ok: false, reason: 'api_error', message: 'scan_version_mismatch' }
      const server = servers[provider]
      if (server === undefined) return { ok: false, reason: 'api_error', message: 'http_404' }
      return { ok: true, page: structuredClone(server.page(query)) }
    },
  }
  return gateway
}

export interface FakeHistoryCache extends HistoryCacheStore {
  records: Map<UsageProvider, HistoryCacheRecord>
  writes: number
  /** update를 이 결과로 실패시킨다(quota·unavailable) */
  failUpdate: 'quota' | 'unavailable' | null
  /** update 직전에 다른 탭이 끼어드는 상황을 흉내 낸다 */
  interleave?: (provider: UsageProvider) => void
}

export function createFakeHistoryCache(initial: HistoryCacheRecord[] = []): FakeHistoryCache {
  const cache: FakeHistoryCache = {
    records: new Map(initial.map((record) => [record.provider, structuredClone(record)])),
    writes: 0,
    failUpdate: null,
    async read(provider) {
      const record = cache.records.get(provider)
      return record === undefined ? null : structuredClone(record)
    },
    async update(provider, mutate) {
      if (cache.failUpdate !== null) return { ok: false, reason: cache.failUpdate }
      cache.interleave?.(provider)
      const current = cache.records.get(provider)
      const next = mutate(current === undefined ? null : structuredClone(current))
      if (next === null) return { ok: true, written: false }
      cache.records.set(provider, structuredClone(next))
      cache.writes += 1
      return { ok: true, written: true }
    },
    async remove(provider) {
      cache.records.delete(provider)
    },
    async listProviders() {
      return [...cache.records.keys()]
    },
  }
  return cache
}

export function createMemoryKeyValue(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map(Object.entries(initial))
  const storage = {
    data,
    failWrites: false,
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: string) => {
      if (storage.failWrites) return false
      data.set(key, value)
      return true
    },
    remove: (key: string) => void data.delete(key),
  }
  return storage
}

/** 합성 이벤트 열: 15분 간격 ok 표본(사용률은 단조 증가). */
export function syntheticEvents(count: number, startIso: string, stepMs = 900_000, startId = 1): UsageHistorySample[] {
  return Array.from({ length: count }, (_unused, index) => {
    const runAt = new Date(Date.parse(startIso) + index * stepMs).toISOString()
    return { id: String(startId + index), runAt, status: 'ok' as const, fetchedAt: runAt, intervalSec: 900, values: [{ id: 'five_hour', usedPercent: (index % 100) + 1, resetsAt: null, cycleSeconds: null }] }
  })
}
