import type { UsageClock, UsageScheduler } from '@domain/usage/gateway'

const NOW_TICK_MS = 30_000

/** Provider 수명에 귀속된 공유 클록. 구독자가 있을 때만 타이머 하나를 유지한다. */
export function createUsageNowStore(clock: UsageClock, scheduler: UsageScheduler) {
  let nowIso = clock.nowIso()
  let cancel: (() => void) | null = null
  const listeners = new Set<() => void>()
  const refresh = (): void => {
    const next = clock.nowIso()
    if (next === nowIso) return
    nowIso = next
    for (const listener of listeners) listener()
  }
  const schedule = (): void => {
    cancel = scheduler.schedule(NOW_TICK_MS, () => {
      refresh()
      if (listeners.size > 0) schedule()
    })
  }
  return {
    getSnapshot: () => nowIso,
    refresh,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      if (listeners.size === 1) {
        refresh()
        schedule()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          cancel?.()
          cancel = null
        }
      }
    },
  }
}
