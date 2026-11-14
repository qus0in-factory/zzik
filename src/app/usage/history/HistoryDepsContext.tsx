import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { HistoryCacheStore, KeyValueStorage, UsageHistoryGateway } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import type { ChartPrefsStore } from './chart-prefs-store'
import { emptyChartViewBuilder } from './chart-view-input'
import type { ChartViewBuilder } from './chart-view-input'
import type { HistoryBudget, SyncOutcome } from './sync-history'

/** 조립 루트(main.tsx)가 만든 이력 계층 의존. 훅은 이 값만 본다. */
export interface HistoryDeps {
  gateway: UsageHistoryGateway
  cache: HistoryCacheStore
  /** 이 탭의 열린 패널(sessionStorage) */
  session: KeyValueStorage
  /** 범례 설정 스토어(localStorage persist) */
  prefs: ChartPrefsStore
  budget: HistoryBudget
  /** 저장소를 못 쓸 때 이번 세션의 레코드를 두는 메모리 */
  memory: Map<UsageProvider, HistoryCacheRecord>
  /** 같은 제공자의 동기화가 겹치지 않게 진행 중인 것을 공유한다 */
  inflight: Map<UsageProvider, Promise<SyncOutcome>>
  /** 차트 뷰 빌더(T3의 buildChartView). 없으면 빈 뷰 */
  buildView?: ChartViewBuilder
  /** 버튼에 포인터·포커스가 닿으면 미리 받는다(지연 청크). */
  preload?: () => void
  nowMs: () => number
}

const HistoryDepsContext = createContext<HistoryDeps | null>(null)

export function HistoryDepsProvider({ deps, children }: { deps: HistoryDeps; children: ReactNode }): ReactNode {
  return <HistoryDepsContext.Provider value={deps}>{children}</HistoryDepsContext.Provider>
}

export function useHistoryDeps(): HistoryDeps {
  const deps = useContext(HistoryDepsContext)
  if (deps === null) throw new Error('HistoryDepsProvider로 이력 의존을 주입해야 한다(조립 루트 담당).')
  return deps
}

export const resolveViewBuilder = (deps: HistoryDeps): ChartViewBuilder => deps.buildView ?? emptyChartViewBuilder
