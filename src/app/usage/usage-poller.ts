import type { UsageScheduler, UsageVisibility } from '@domain/usage/gateway'
import type { UsageLoadResult } from './load-usage'

/**
 * 사용량 조회 폴러(ADR 0.2 D11, 시나리오 U11·U12의 상태 전이 밖 동작).
 * - 주기 호출: intervalMs 간격으로 호출하고 화면이 보일 때만 실행한다.
 * - 탭 가시성: 숨겨진 동안 정지, 보이는 순간 즉시 호출.
 * - 중복 호출 방지: 진행 중 실행이 있으면 새 호출을 그 실행에 합친다.
 * React에 의존하지 않는다. 시간·가시성은 포트로 주입받는다.
 */

export interface UsagePollerDeps {
  fetch(): Promise<UsageLoadResult>
  intervalMs: number
  scheduler: UsageScheduler
  visibility: UsageVisibility
}

export interface UsagePollerHandlers {
  onResult(result: UsageLoadResult): void
}

export interface UsagePoller {
  start(): void
  stop(): void
  /** 수동 갱신(새로고침 버튼). 진행 중 실행에 합쳐진다. */
  refresh(): Promise<void>
}

export function createUsagePoller(deps: UsagePollerDeps, handlers: UsagePollerHandlers): UsagePoller {
  let started = false
  let tickCancel: (() => void) | null = null
  let unsubscribeVisibility: (() => void) | null = null
  let inFlight: Promise<void> | null = null

  const run = (): Promise<void> => {
    if (inFlight) return inFlight
    inFlight = deps
      .fetch()
      .then((result) => {
        handlers.onResult(result)
      })
      .catch((error: unknown) => {
        // fetch는 결과 유니온을 돌려주므로 여기가 곧 실패이다(게이트웨이 구현의 방어선).
        handlers.onResult({ ok: false, reason: 'api_error', message: `폴러 오류: ${String(error)}` })
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  const scheduleNextTick = (): void => {
    tickCancel?.()
    tickCancel = deps.scheduler.schedule(deps.intervalMs, onTick)
  }

  const onTick = (): void => {
    tickCancel = null
    if (!started) return
    scheduleNextTick()
    if (!deps.visibility.isVisible() || inFlight) return
    void run()
  }

  const onVisibilityChanged = (): void => {
    if (!deps.visibility.isVisible() || !started || inFlight) return
    void run()
  }

  return {
    start() {
      if (started) return
      started = true
      unsubscribeVisibility = deps.visibility.subscribe(onVisibilityChanged)
      scheduleNextTick()
      if (deps.visibility.isVisible() && !inFlight) void run()
    },
    stop() {
      started = false
      unsubscribeVisibility?.()
      unsubscribeVisibility = null
      tickCancel?.()
      tickCancel = null
    },
    refresh() {
      return run()
    },
  }
}
