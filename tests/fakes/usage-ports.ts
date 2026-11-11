import type { UsageClock, UsageGateway, UsageGatewayResult, UsageScheduler } from '@domain/usage/gateway'

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

interface QueuedItem {
  item: UsageGatewayResult | { deferred: Deferred<UsageGatewayResult> }
}

export interface FakeUsageGateway extends UsageGateway {
  calls: number
  queue: QueuedItem['item'][]
  pushResult(result: UsageGatewayResult): void
  pushDeferred(): Deferred<UsageGatewayResult>
}

export function createFakeUsageGateway(): FakeUsageGateway {
  const queue: QueuedItem['item'][] = []
  const gateway: FakeUsageGateway = {
    calls: 0,
    queue,
    async fetchUsage() {
      gateway.calls += 1
      const item = queue.shift() ?? { ok: false as const, reason: 'api_error' as const, message: '가짜 큐가 비었다' }
      if ('deferred' in item) return item.deferred.promise
      return item
    },
    pushResult(result) {
      queue.push(result)
    },
    pushDeferred() {
      const deferred = createDeferred<UsageGatewayResult>()
      queue.push({ deferred })
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
