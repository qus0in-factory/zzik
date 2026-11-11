import type { UsageClock, UsageScheduler, UsageVisibility } from '@domain/usage/gateway'

/** 브라우저 기본 환경용 포트 구현. 조립 루트(main.tsx)만 생성해 주입한다. */

export function createBrowserScheduler(): UsageScheduler {
  return {
    schedule(ms, run) {
      const id = setTimeout(run, ms)
      return () => clearTimeout(id)
    },
  }
}

export function createBrowserVisibility(): UsageVisibility {
  return {
    isVisible() {
      if (typeof document === 'undefined') return true
      return document.visibilityState === 'visible'
    },
    subscribe(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

export function createBrowserClock(): UsageClock {
  return { nowIso: () => new Date().toISOString() }
}
