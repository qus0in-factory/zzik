import { useEffect, useRef } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { usageQueryKey, usageQueryOptions } from '../usage-query'
import type { UsageGatewaySuccess } from '@domain/usage/gateway'
import { useUsageDeps } from '../UsageGatewayContext'
import { useHistoryDeps } from './HistoryDepsContext'
import { historyDataKey, historyWarmKey, runDedupedSync } from './history-query'

/**
 * 워밍(ADR 0.7 6.3절): 이 브라우저에 레코드가 있는 제공자만, 스냅샷 `runAt`이 마지막 동기화 때와 달라졌고 문서가 보일 때,
 * 백그라운드에서 정방향을 한 번에 하나씩 돌린다. 깨어 있는 컴퓨트 창에 미리 받아 두어 나중에 차트를 열 때 조회가 없게 한다.
 * 백필은 하지 않는다(범위는 패널을 열 때만 넓힌다).
 */
export function useHistoryWarmSync(): void {
  const deps = useHistoryDeps()
  const usageDeps = useUsageDeps()
  const client = useQueryClient()
  const warm = useQuery({ queryKey: historyWarmKey, queryFn: () => deps.cache.listProviders(), staleTime: Infinity })
  const snapshots = useQueries({ queries: USAGE_PROVIDERS.map((provider) => usageQueryOptions(usageDeps.gateway, provider)) })
  const runAtKey = snapshots.map((query) => query.data?.collection?.runAt ?? '-').join(',')
  const providersKey = (warm.data ?? []).join(',')
  const running = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    let cancelled = false
    const drain = async (): Promise<void> => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        do {
          again.current = false
          for (const provider of USAGE_PROVIDERS as readonly UsageProvider[]) {
            if (cancelled || document.visibilityState === 'hidden') return
            if (!(warm.data ?? []).includes(provider)) continue
            const runAt = client.getQueryData<UsageGatewaySuccess>(usageQueryKey(provider))?.collection?.runAt ?? null
            if (runAt === null) continue
            const record = deps.memory.get(provider) ?? (await deps.cache.read(provider))
            if (record === null || record.syncedThroughRunAt === runAt) continue
            await runDedupedSync(
              deps.inflight,
              { gateway: deps.gateway, cache: deps.cache, memory: deps.memory, nowMs: deps.nowMs, budget: deps.budget, onRecord: (next) => client.setQueryData(historyDataKey(provider), next) },
              { provider, snapshotRunAt: runAt, wantFromMs: null },
            )
          }
        } while (again.current && !cancelled)
      } finally {
        running.current = false
      }
    }
    void drain()
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void drain()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
    // 스냅샷 runAt 또는 레코드가 있는 제공자 목록이 바뀔 때 다시 돈다.
  }, [runAtKey, providersKey, client, deps, warm.data])
}
