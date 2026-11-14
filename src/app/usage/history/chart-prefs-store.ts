import { createJSONStorage, persist } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import type { KeyValueStorage } from '@domain/usage/history/ports'
import type { ChartRange } from '@domain/usage/history/types'

/**
 * 범례 설정 스토어(ADR 0.7 9절). 스택 부록 A5의 "persist 미들웨어 미사용"은 이 스토어에 한해 푼다(ADR 0.7 2절).
 * 저장소는 주입한 동기 KeyValueStorage(localStorage 어댑터)이고 서버에는 보내지 않는다.
 * 숨긴 계열 id만 저장한다(새 계열은 기본으로 보인다). 지금 데이터에 없는 id도 지우지 않는다.
 */
export const CHART_PREFS_KEY = 'zzik:chart-prefs:v1'
export const CHART_PREFS_VERSION = 1
/** 제공자당 보관하는 id 수(넘으면 오래 넣은 것부터 버린다). */
export const CHART_PREFS_MAX_IDS = 50
export const DEFAULT_CHART_RANGE: ChartRange = '7d'

const RANGES: readonly ChartRange[] = ['24h', '7d', '30d']

export interface ProviderChartPrefs {
  /** 숨긴 계열 id(슬롯 1~8) */
  hidden: string[]
  /** 기본 숨김인 9번째 이후 계열 중 사용자가 켠 것 */
  shown: string[]
  range: ChartRange
}

export interface ChartPrefsState {
  providers: Partial<Record<UsageProvider, ProviderChartPrefs>>
  setRange(provider: UsageProvider, range: ChartRange): void
  /** 슬롯 1~8은 hidden에, 슬롯 0(기본 숨김)은 shown에 넣거나 뺀다. */
  toggleSeries(provider: UsageProvider, seriesId: string, isOverflowSlot: boolean): void
  /** 슬롯 1~8의 숨김을 모두 푼다. shown은 그대로. */
  showAll(provider: UsageProvider): void
}

export type ChartPrefsStore = StoreApi<ChartPrefsState> & { persist: { rehydrate(): Promise<void> | void } }

export function prefsOf(state: Pick<ChartPrefsState, 'providers'>, provider: UsageProvider): ProviderChartPrefs {
  const stored = state.providers[provider]
  return { hidden: stored?.hidden ?? [], shown: stored?.shown ?? [], range: stored?.range ?? DEFAULT_CHART_RANGE }
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-CHART_PREFS_MAX_IDS) : [])

/** 저장된 값(어떤 모양이든)을 안전한 `providers`로 바꾼다. 모르는 제공자·값은 버리고 깨진 값은 기본으로. */
function sanitizeProviders(raw: unknown): ChartPrefsState['providers'] {
  const providers: ChartPrefsState['providers'] = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return providers
  for (const provider of USAGE_PROVIDERS) {
    const entry = (raw as Record<string, unknown>)[provider]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    providers[provider] = { hidden: stringList(record.hidden), shown: stringList(record.shown), range: RANGES.includes(record.range as ChartRange) ? (record.range as ChartRange) : DEFAULT_CHART_RANGE }
  }
  return providers
}

const withId = (list: readonly string[], id: string): string[] => [...list.filter((item) => item !== id), id].slice(-CHART_PREFS_MAX_IDS)

export function createChartPrefsStore(storage: KeyValueStorage): ChartPrefsStore {
  return createStore<ChartPrefsState>()(
    persist(
      (set) => ({
        providers: {},
        setRange: (provider, range) => set((state) => ({ providers: { ...state.providers, [provider]: { ...prefsOf(state, provider), range } } })),
        toggleSeries: (provider, seriesId, isOverflowSlot) =>
          set((state) => {
            const prefs = prefsOf(state, provider)
            const field = isOverflowSlot ? 'shown' : 'hidden'
            const next = prefs[field].includes(seriesId) ? prefs[field].filter((item) => item !== seriesId) : withId(prefs[field], seriesId)
            return { providers: { ...state.providers, [provider]: { ...prefs, [field]: next } } }
          }),
        showAll: (provider) => set((state) => ({ providers: { ...state.providers, [provider]: { ...prefsOf(state, provider), hidden: [] } } })),
      }),
      {
        name: CHART_PREFS_KEY,
        version: CHART_PREFS_VERSION,
        storage: createJSONStorage(() => ({ getItem: (key) => storage.get(key), setItem: (key, value) => void storage.set(key, value), removeItem: (key) => storage.remove(key) })),
        partialize: (state) => ({ providers: state.providers }),
        migrate: (persisted) => ({ providers: sanitizeProviders((persisted as { providers?: unknown } | null)?.providers) }) as ChartPrefsState,
        merge: (persisted, current) => ({ ...current, providers: sanitizeProviders((persisted as { providers?: unknown } | null)?.providers) }),
      },
    ),
  ) as ChartPrefsStore
}
