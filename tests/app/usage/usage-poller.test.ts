import { describe, expect, it, vi } from 'vitest'
import { createUsagePoller } from '@app/usage/usage-poller'
import { loadUsage } from '@app/usage/load-usage'
import { createDeferred, createFakeUsageGateway, createFakeUsageScheduler, createFakeUsageVisibility } from '../../fakes/usage-ports'

const INTERVAL_MS = 60_000

/** 보류 중인 마이크로태스크(진행 중 fetch의 finally 등)를 모두 흘려보낸다. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function makeHarness(initialVisible = true) {
  const gateway = createFakeUsageGateway()
  const scheduler = createFakeUsageScheduler()
  const visibility = createFakeUsageVisibility(initialVisible)
  const onResult = vi.fn()
  const poller = createUsagePoller(
    { fetch: () => loadUsage(gateway), intervalMs: INTERVAL_MS, scheduler, visibility },
    { onResult },
  )
  return { gateway, scheduler, visibility, onResult, poller }
}

describe('Given the usage poller', () => {
  it('When started while visible then it fetches immediately and schedules the next interval', () => {
    const { gateway, scheduler, poller, onResult } = makeHarness()
    poller.start()
    expect(gateway.calls).toBe(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(scheduler.snapshot()).toContainEqual({ ms: INTERVAL_MS, cancelled: false })
  })

  it('When the interval elapses while visible then it keeps polling', async () => {
    const { gateway, scheduler, poller } = makeHarness()
    poller.start()
    expect(gateway.calls).toBe(1)
    await settle()
    scheduler.runScheduledAt(INTERVAL_MS)
    expect(gateway.calls).toBe(2)
    await settle()
    scheduler.runScheduledAt(INTERVAL_MS)
    expect(gateway.calls).toBe(3)
  })

  it('When a fetch completes then the handler receives the result once', async () => {
    const { poller, onResult, gateway } = makeHarness()
    gateway.pushResult({ ok: true, usage: {} })
    poller.start()
    await settle()
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0]).toEqual({ ok: true, report: expect.anything() })
  })

  it('When the tab is hidden then scheduled ticks do not fetch', async () => {
    const { gateway, scheduler, visibility, poller } = makeHarness()
    poller.start()
    expect(gateway.calls).toBe(1)
    await settle()
    visibility.setVisible(false)
    scheduler.runScheduledAt(INTERVAL_MS)
    expect(gateway.calls).toBe(1)
  })

  it('When the tab becomes visible again then it fetches right away', async () => {
    const { gateway, visibility, poller } = makeHarness()
    poller.start()
    expect(gateway.calls).toBe(1)
    await settle()
    visibility.setVisible(false)
    expect(gateway.calls).toBe(1)
    visibility.setVisible(true)
    expect(gateway.calls).toBe(2)
  })

  it('When a refresh is requested while a fetch is in flight then the calls merge into one', async () => {
    const { gateway, poller } = makeHarness()
    const deferred = gateway.pushDeferred()
    const first = poller.refresh()
    const second = poller.refresh()
    expect(gateway.calls).toBe(1)
    deferred.resolve({ ok: true, usage: {} })
    await Promise.all([first, second])
    expect(gateway.calls).toBe(1)
  })

  it('When a tick happens while a fetch is in flight then it is skipped', async () => {
    const { gateway, scheduler, poller, onResult } = makeHarness()
    const deferred = gateway.pushDeferred()
    poller.start()
    expect(gateway.calls).toBe(1)
    scheduler.runScheduledAt(INTERVAL_MS)
    expect(gateway.calls).toBe(1)
    deferred.resolve({ ok: true, usage: {} })
    await settle()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('When stopped then no further fetch happens for ticks or visibility changes', async () => {
    const { gateway, scheduler, visibility, poller } = makeHarness()
    const deferred = gateway.pushDeferred()
    poller.start()
    poller.stop()
    expect(visibility.listenerCount()).toBe(0)
    scheduler.runScheduledAt(INTERVAL_MS)
    visibility.setVisible(true)
    expect(gateway.calls).toBe(1)
    deferred.resolve({ ok: true, usage: {} })
    await settle()
  })
})
