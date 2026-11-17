import { queryOptions } from '@tanstack/react-query'
import { USAGE_BUCKET_SEC } from '../../../../shared/usage-history-contract'
import type { UsageHistoryBucketsPage, UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import { validateRecord } from '@domain/usage/history/record'
import { RANGE_MS } from '@domain/usage/history/chart-time-domain'
import type { HistoryCacheStore, UsageHistoryGateway } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { UsageLoadError } from '../usage-query'
import type { SyncArgs, SyncDeps, SyncOutcome } from './sync-history'

/** 요약 stale 15분(6.1절). */
export const HISTORY_SUMMARY_STALE_MS = 15 * 60_000
/** 패널을 닫으면 레코드 쿼리를 10분 뒤 해제한다. */
export const HISTORY_DATA_GC_MS = 10 * 60_000

export const historySummaryKey = ['usage-history-summary'] as const
export const historyKey = (provider: UsageProvider) => ['usage-history', provider] as const
export const historyDataKey = (provider: UsageProvider) => ['usage-history', provider, 'data'] as const
export const historySyncKey = (provider: UsageProvider) => ['usage-history', provider, 'sync'] as const
export const historyBucketsKey = (provider: UsageProvider) => ['usage-history', provider, 'buckets', '30d'] as const
export const historyWarmKey = ['usage-history-warm-providers'] as const

/** 요약 쿼리: 페이지 로드에서 스냅샷과 함께 1회, 15분 stale. 실패는 UsageLoadError로 던진다(재시도 정책은 Query 한 곳). */
export function historySummaryQueryOptions(gateway: UsageHistoryGateway, seed?: { data: UsageHistorySummaryEntry[]; updatedAt: number }) {
  return queryOptions({
    queryKey: historySummaryKey,
    queryFn: async (): Promise<UsageHistorySummaryEntry[]> => {
      const result = await gateway.fetchSummary()
      if (!result.ok) throw new UsageLoadError(result.reason, result.message)
      return result.summary
    },
    staleTime: HISTORY_SUMMARY_STALE_MS,
    ...(seed === undefined ? {} : { initialData: seed.data, initialDataUpdatedAt: seed.updatedAt }),
  })
}

/** 레코드 쿼리: IndexedDB(또는 메모리 대체)를 읽는다. 버전이 다른 레코드는 폐기한다(I6). stale 없음 — 동기화가 setQueryData로 갱신한다. */
export function historyDataQueryOptions(deps: { cache: HistoryCacheStore; memory: Map<UsageProvider, HistoryCacheRecord> }, provider: UsageProvider) {
  return queryOptions({
    queryKey: historyDataKey(provider),
    queryFn: async (): Promise<HistoryCacheRecord | null> => {
      const memory = deps.memory.get(provider)
      if (memory !== undefined) return memory
      const stored = await deps.cache.read(provider)
      if (stored === null) return null
      const valid = validateRecord(stored, provider)
      if (valid === null) {
        await deps.cache.remove(provider)
        return null
      }
      return valid
    },
    staleTime: Infinity,
    gcTime: HISTORY_DATA_GC_MS,
  })
}

/** 동기화 결과를 Query가 이해하는 예외로 바꾼다(성공은 그대로). */
export function throwForOutcome(outcome: SyncOutcome): HistoryCacheRecord {
  if (outcome.ok) return outcome.record
  if (outcome.reason === 'version_mismatch') throw new UsageLoadError('api_error', 'scan_version_mismatch')
  if (outcome.reason === 'budget') throw new UsageLoadError('api_error', 'history_budget')
  if (outcome.reason === 'conflict') throw new UsageLoadError('api_error', 'history_conflict')
  if (outcome.reason === 'cancelled') throw new UsageLoadError('api_error', 'history_cancelled')
  if (outcome.reason === 'gateway') throw new UsageLoadError(outcome.failure.reason, outcome.failure.message)
  throw new UsageLoadError('api_error', null)
}

interface InflightState {
  controller: AbortController
  consumers: number
}

/** inflight Map 객체별 소비자 수·공유 중단 신호. Map 타입은 기존 호출부와 호환되게 유지한다. */
const inflightStates = new WeakMap<object, Map<UsageProvider, InflightState>>()

function stateMap(inflight: Map<UsageProvider, Promise<SyncOutcome>>): Map<UsageProvider, InflightState> {
  let states = inflightStates.get(inflight)
  if (states === undefined) {
    states = new Map()
    inflightStates.set(inflight, states)
  }
  return states
}

/** 소비자 하나의 수명을 공유 동기화에 연결한다. 마지막 소비자가 떠나면 다음 페이지 요청을 멈춘다. */
function consume(promise: Promise<SyncOutcome>, state: InflightState, signal?: AbortSignal): Promise<SyncOutcome> {
  let released = false
  function onAbort(): void {
    release()
  }
  function release(): void {
    if (released) return
    released = true
    state.consumers -= 1
    if (state.consumers <= 0) state.controller.abort()
    if (signal !== undefined) signal.removeEventListener('abort', onAbort)
  }
  if (signal !== undefined) {
    if (signal.aborted) release()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return promise.finally(release)
}

/** 같은 제공자의 동기화가 진행 중이면 그 결과를 기다린다(패널·워밍이 겹쳐도 요청이 두 번 나가지 않는다). */
export function runDedupedSync(
  inflight: Map<UsageProvider, Promise<SyncOutcome>>,
  deps: SyncDeps,
  args: SyncArgs,
  signal?: AbortSignal,
): Promise<SyncOutcome> {
  const states = stateMap(inflight)
  const running = inflight.get(args.provider)
  const existing = states.get(args.provider)
  if (running !== undefined && existing !== undefined && !existing.controller.signal.aborted) {
    existing.consumers += 1
    const joined = consume(running, existing, signal)
    if (args.wantFromMs === null) return joined
    return joined.then((outcome) => {
      if (!outcome.ok || outcome.backfillComplete || signal?.aborted === true) return outcome
      const coveredFrom = outcome.record.coveredFrom === null ? NaN : Date.parse(outcome.record.coveredFrom)
      if (Number.isFinite(coveredFrom) && args.wantFromMs !== null && args.wantFromMs < coveredFrom) return runDedupedSync(inflight, deps, args, signal)
      return outcome
    })
  }
  const controller = new AbortController()
  const state: InflightState = { controller, consumers: 1 }
  states.set(args.provider, state)
  const shouldStop = (): boolean => controller.signal.aborted || deps.shouldStop?.() === true
  // 동기화 엔진은 처음 필요할 때 받는다(메인 번들에서 뺀다). 같은 모듈이 main.tsx의 동적 import와 한 청크로 묶인다.
  const promise = import('./sync-history')
    .then(({ syncHistory }) => syncHistory({ ...deps, shouldStop }, args))
    .finally(() => {
      if (inflight.get(args.provider) === promise) inflight.delete(args.provider)
      if (states.get(args.provider) === state) states.delete(args.provider)
    })
  inflight.set(args.provider, promise)
  return consume(promise, state, signal)
}

/** 30-day bucket query. The response stays in Query memory and is not written to IndexedDB. */
export function historyBucketsQueryOptions(
  deps: { gateway: UsageHistoryGateway; nowMs: () => number; budget: { begin(provider: UsageProvider): () => boolean } },
  provider: UsageProvider,
) {
  return queryOptions({
    queryKey: historyBucketsKey(provider),
    queryFn: async (): Promise<UsageHistoryBucketsPage> => {
      const untilMs = deps.nowMs()
      const fromMs = untilMs - RANGE_MS['30d']
      const take = deps.budget.begin(provider)
      if (!take()) throw new UsageLoadError('api_error', 'history_budget')
      const result = await deps.gateway.fetchBuckets(provider, {
        from: new Date(fromMs).toISOString(),
        until: new Date(untilMs).toISOString(),
        bucketSec: USAGE_BUCKET_SEC,
      })
      if (!result.ok) throw new UsageLoadError(result.reason, result.message)
      return result.page
    },
    staleTime: HISTORY_SUMMARY_STALE_MS,
    gcTime: HISTORY_DATA_GC_MS,
    refetchOnWindowFocus: false,
  })
}
