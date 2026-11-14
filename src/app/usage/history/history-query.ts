import { queryOptions } from '@tanstack/react-query'
import type { UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import { validateRecord } from '@domain/usage/history/record'
import type { HistoryCacheStore, UsageHistoryGateway } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { UsageLoadError } from '../usage-query'
import { syncHistory } from './sync-history'
import type { SyncArgs, SyncDeps, SyncOutcome } from './sync-history'

/** 요약 stale 15분(6.1절). */
export const HISTORY_SUMMARY_STALE_MS = 15 * 60_000
/** 패널을 닫으면 레코드 쿼리를 10분 뒤 해제한다. */
export const HISTORY_DATA_GC_MS = 10 * 60_000

export const historySummaryKey = ['usage-history-summary'] as const
export const historyKey = (provider: UsageProvider) => ['usage-history', provider] as const
export const historyDataKey = (provider: UsageProvider) => ['usage-history', provider, 'data'] as const
export const historySyncKey = (provider: UsageProvider) => ['usage-history', provider, 'sync'] as const
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
  if (outcome.reason === 'gateway') throw new UsageLoadError(outcome.failure.reason, outcome.failure.message)
  throw new UsageLoadError('api_error', null)
}

/** 같은 제공자의 동기화가 진행 중이면 그 결과를 기다린다(패널·워밍이 겹쳐도 요청이 두 번 나가지 않는다). */
export function runDedupedSync(inflight: Map<UsageProvider, Promise<SyncOutcome>>, deps: SyncDeps, args: SyncArgs): Promise<SyncOutcome> {
  const running = inflight.get(args.provider)
  if (running !== undefined) return running
  const promise = syncHistory(deps, args).finally(() => inflight.delete(args.provider))
  inflight.set(args.provider, promise)
  return promise
}
