import type { UsageClock, UsageScheduler } from '@domain/usage/gateway'

/** 브라우저 기본 환경용 포트 구현. 조립 루트(main.tsx)만 생성해 주입한다.
 * 가시성은 TanStack Query의 포커스·백그라운드 옵션이 맡는다(스택 부록 A4: 가시성 포트 삭제).
 */

export function createBrowserScheduler(): UsageScheduler {
  return {
    schedule(ms, run) {
      const id = setTimeout(run, ms)
      return () => clearTimeout(id)
    },
  }
}

export function createBrowserClock(): UsageClock {
  return { nowIso: () => new Date().toISOString() }
}
