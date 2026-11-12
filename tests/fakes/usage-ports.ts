import type { UsageClock, UsageGateway, UsageGatewayResult, UsageScheduler } from '@domain/usage/gateway'
import type { UsageProvider } from '@domain/usage/providers'

export const NOW_ISO = '2026-11-11T12:00:00.000Z'
export const NOW = new Date(NOW_ISO)

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

type Queued = UsageGatewayResult | { deferred: Deferred<UsageGatewayResult> }

export interface FakeUsageGateway extends UsageGateway {
  /** 전체 호출 수(기존 테스트 계약) */
  calls: number
  callsByProvider: Record<UsageProvider, number>
  queue: Queued[]
  pushResult(result: UsageGatewayResult): void
  pushResultFor(provider: UsageProvider, result: UsageGatewayResult): void
  pushDeferred(): Deferred<UsageGatewayResult>
}

/**
 * 포트 가짜(스택 부록 A6). 제공자별 큐를 따로 두어 한쪽 실패가 다른 쪽 섹션에
 * 섞이지 않는지 테스트할 수 있다. 큐가 비면 api_error를 돌려준다.
 */
export function createFakeUsageGateway(): FakeUsageGateway {
  const shared: Queued[] = []
  const perProvider: Record<UsageProvider, Queued[]> = { claude: [], codex: [], antigravity: [] }
  const callsByProvider: Record<UsageProvider, number> = { claude: 0, codex: 0, antigravity: 0 }

  const gateway: FakeUsageGateway = {
    calls: 0,
    callsByProvider,
    queue: shared,
    async fetchUsage(provider: UsageProvider) {
      gateway.calls += 1
      callsByProvider[provider] += 1
      const item = perProvider[provider].shift() ?? shared.shift() ?? {
        ok: false as const,
        reason: 'api_error' as const,
        message: '가짜 큐가 비었다',
      }
      if ('deferred' in item) return item.deferred.promise
      return item
    },
    pushResult(result) {
      shared.push(result)
    },
    pushResultFor(provider, result) {
      perProvider[provider].push(result)
    },
    pushDeferred() {
      const deferred = createDeferred<UsageGatewayResult>()
      shared.push({ deferred })
      return deferred
    },
  }
  return gateway
}

export interface FakeUsageScheduler extends UsageScheduler {
  snapshot(): Array<{ ms: number; cancelled: boolean }>
  runAll(): void
  runScheduledAt(ms: number): void
  pendingCount(): number
}

export function createFakeUsageScheduler(): FakeUsageScheduler {
  interface Task {
    ms: number
    run: () => void
    cancelled: boolean
  }
  const tasks: Task[] = []
  const scheduler: FakeUsageScheduler = {
    schedule(ms, run) {
      const task: Task = { ms, run, cancelled: false }
      tasks.push(task)
      return () => {
        task.cancelled = true
      }
    },
    snapshot() {
      return tasks.map(({ ms, cancelled }) => ({ ms, cancelled }))
    },
    runAll() {
      const due = tasks.filter((task) => !task.cancelled)
      tasks.length = 0
      due.forEach((task) => task.run())
    },
    runScheduledAt(ms) {
      const due = tasks.filter((task) => !task.cancelled && task.ms === ms)
      due.forEach((task) => {
        task.cancelled = true
        task.run()
      })
    },
    pendingCount() {
      return tasks.filter((task) => !task.cancelled).length
    },
  }
  return scheduler
}

export interface FakeUsageClock extends UsageClock {
  setIso(iso: string): void
}

export function createFakeUsageClock(iso = NOW_ISO): FakeUsageClock {
  let current = iso
  return {
    nowIso: () => current,
    setIso(next) {
      current = next
    },
  }
}
