import type { OffpeakSchedule } from '@domain/usage/offpeak'
import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { UsageClock, UsageGateway, UsageScheduler } from '@domain/usage/gateway'
import { createUsageNowStore } from './usage-now-store'
import { createCardActivityStore } from './card-activity-store'
import type { CardActivityStore } from './card-activity-store'

/** 조립 루트(main.tsx)가 만든 게이트웨이·시계·타이머(now 틱) 의존을 훅에 전달한다.
 * 가시성은 TanStack Query의 refetchIntervalInBackground·refetchOnWindowFocus가 맡는다(스택 부록 A4).
 */
export interface UsageDeps {
  gateway: UsageGateway
  clock: UsageClock
  scheduler: UsageScheduler
  offpeak?: OffpeakSchedule
}

const UsageGatewayContext = createContext<UsageDeps | null>(null)
const UsageNowContext = createContext<ReturnType<typeof createUsageNowStore> | null>(null)
const CardActivityContext = createContext<CardActivityStore | null>(null)

/** 카드 활동 기록은 Provider 수명 동안 유지된다(카드 언마운트에도 기준값 보존).
 * 테스트·조립 루트가 activityStore를 주입하면 그 스토어를 쓴다.
 */
export function UsageGatewayProvider({ deps, activityStore, children }: { deps: UsageDeps; activityStore?: CardActivityStore; children: ReactNode }): ReactNode {
  const [ownStore] = useState(createCardActivityStore)
  const nowStore = useMemo(() => createUsageNowStore(deps.clock, deps.scheduler), [deps.clock, deps.scheduler])
  return (
    <UsageGatewayContext.Provider value={deps}>
      <UsageNowContext.Provider value={nowStore}>
        <CardActivityContext.Provider value={activityStore ?? ownStore}>{children}</CardActivityContext.Provider>
      </UsageNowContext.Provider>
    </UsageGatewayContext.Provider>
  )
}

export function useUsageDeps(): UsageDeps {
  const deps = useContext(UsageGatewayContext)
  if (!deps) {
    throw new Error('UsageGatewayProvider로 사용량 의존을 주입해야 한다(조립 루트 담당).')
  }
  return deps
}

export function useCardActivityStore(): CardActivityStore {
  const store = useContext(CardActivityContext)
  if (!store) {
    throw new Error('UsageGatewayProvider로 카드 활동 스토어를 주입해야 한다(조립 루트 담당).')
  }
  return store
}

/** 최상단 칩·카드·차트가 같은 스냅샷을 구독하며 성공 응답 도착 시에도 현재 시각을 갱신한다. */
export function useUsageNow() {
  const store = useContext(UsageNowContext)
  if (store === null) throw new Error('UsageGatewayProvider로 공유 클록을 주입해야 한다.')
  const nowIso = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { nowIso, refreshNow: store.refresh }
}
