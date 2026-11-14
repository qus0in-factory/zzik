import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { HistoryCacheStore, KeyValueStorage, UsageHistoryGateway } from '@domain/usage/history/ports'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'
import { createStore } from 'zustand/vanilla'
import type { ChartPrefsState, ChartPrefsStore } from './chart-prefs-store'
import { emptyChartViewBuilder } from './chart-view-input'
import type { ChartViewBuilder } from './chart-view-input'
import type { HistoryBudget, SyncOutcome } from './sync-history'

/** 조립 루트(main.tsx)가 만든 이력 계층 의존. 훅은 이 값만 본다. */
export interface HistoryDeps {
  /**
   * 기능 플래그(빌드 시 `__HISTORY_ENABLED__`, 기본 꺼짐). false면 훅은 아무 것도 하지 않는다:
   * 이력 HTTP 호출 0, IndexedDB open 0, 저장소 쓰기 0. 데이터 계층만 먼저 꺼진 채로 배포하기 위한 스위치다.
   */
  enabled: boolean
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

/** 플래그가 꺼졌을 때 조립 루트가 쓰는 비활성 의존: 어떤 포트도 실제로 건드리지 않는다(infra 모듈을 불러오지도 않는다). */
export function createDisabledHistoryDeps(): HistoryDeps {
  const off = { ok: false, reason: 'api_error', message: 'history_disabled' } as const
  const inert: KeyValueStorage = { get: () => null, set: () => false, remove: () => {} }
  return {
    enabled: false,
    gateway: { fetchSummary: async () => off, fetchSamples: async () => off },
    cache: { read: async () => null, update: async () => ({ ok: false, reason: 'unavailable' }), remove: async () => {}, listProviders: async () => [] },
    session: inert,
    prefs: Object.assign(createStore<ChartPrefsState>(() => ({ providers: {}, setRange: () => {}, toggleSeries: () => {}, showAll: () => {} })), { persist: { rehydrate: () => {} } }) as ChartPrefsStore,
    budget: { begin: () => () => false } satisfies HistoryBudget,
    memory: new Map(),
    inflight: new Map(),
    nowMs: () => Date.now(),
  }
}

export const resolveViewBuilder = (deps: HistoryDeps): ChartViewBuilder => deps.buildView ?? emptyChartViewBuilder
