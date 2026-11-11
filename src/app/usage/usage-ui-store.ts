import { create } from 'zustand'
import { parseFixtureUsageName } from '@domain/usage/fixture-name'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'

/**
 * 클라이언트 전용 상태 스토어(스택 부록 A5, ADR 0.3 D8).
 * ui는 이 스토어를 직접 import하지 않고 app이 내보내는 훅만 쓴다.
 * 서버에서 온 값(보고서, 봉투, 수집 판정, 로딩·오류 상태, 마지막 성공 시각)은 여기에 두지 않는다
 * — Query 캐시와 훅의 파생 계산만 둔다(스택 부록 A8). persist 미들웨어도 쓰지 않는다.
 */

const CLOSED: Record<UsageProvider, boolean> = { claude: false, codex: false }

function initialOpen(): Record<UsageProvider, boolean> {
  return { ...CLOSED }
}

export interface UsageUiStoreState {
  /** Raw JSON 펼침 여부 — 제공자별로 따로 기억한다(조회 갱신·재마운트에도 유지) */
  rawJsonOpen: Record<UsageProvider, boolean>
  setRawJsonOpen(provider: UsageProvider, open: boolean): void
  toggleRawJson(provider: UsageProvider): void
  /** 픽스처 선택(DEV 전용). 조립 루트가 게이트웨이 getter와 invalidate에 쓴다 */
  fixtureName: string
  setFixtureName(name: string): void
}

/** 픽스처 선택 초기값: 주어진 쿼리 문자열을 해석하고, 생략하면 현재 location을 쓴다(A5). */
export function initialFixtureName(initialSearch?: string | null | undefined): string {
  try {
    if (initialSearch !== undefined && initialSearch !== null) return parseFixtureUsageName(initialSearch)
    if (typeof window === 'undefined') return 'normal'
    return parseFixtureUsageName(window.location.search)
  } catch {
    return 'normal'
  }
}

export function createUsageUiStore(initialSearch?: string | null) {
  return create<UsageUiStoreState>()((set) => ({
    rawJsonOpen: initialOpen(),
    setRawJsonOpen: (provider, open) =>
      set((prev) => ({ rawJsonOpen: { ...prev.rawJsonOpen, [provider]: open } })),
    toggleRawJson: (provider) =>
      set((prev) => ({ rawJsonOpen: { ...prev.rawJsonOpen, [provider]: !prev.rawJsonOpen[provider] } })),
    fixtureName: initialFixtureName(initialSearch),
    setFixtureName: (name) => set({ fixtureName: name }),
  }))
}

/** 애플리케이션 싱글턴. 초기값은 부팅 시점의 location에서 읽는다. */
export const useUsageUiStore = createUsageUiStore()

/** ui가 쓰는 훅: 제공자별 raw JSON 펼침 상태와 토글. */
export function useRawJsonOpen(provider: UsageProvider): { open: boolean; toggle(): void; setOpen(open: boolean): void } {
  const open = useUsageUiStore((state) => state.rawJsonOpen[provider])
  const toggleRawJson = useUsageUiStore((state) => state.toggleRawJson)
  const setRawJsonOpen = useUsageUiStore((state) => state.setRawJsonOpen)
  return {
    open,
    toggle: () => toggleRawJson(provider),
    setOpen: (next: boolean) => setRawJsonOpen(provider, next),
  }
}

/** ui가 쓰는 훅: 픽스처 선택(DEV 전용 화면 스위치용). */
export function useFixtureChoice(): { fixtureName: string; setFixtureName(name: string): void } {
  const fixtureName = useUsageUiStore((state) => state.fixtureName)
  const setFixtureName = useUsageUiStore((state) => state.setFixtureName)
  return { fixtureName, setFixtureName }
}

/** 등록부에 정의된 제공자 전체. 테스트가 스토어 기본값을 확인할 때 쓴다. */
export const STORE_PROVIDERS: readonly UsageProvider[] = USAGE_PROVIDERS
