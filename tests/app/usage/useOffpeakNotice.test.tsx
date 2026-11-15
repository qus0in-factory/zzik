// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useOffpeakNotice } from '@app/usage/useOffpeakNotice'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import type { FakeUsageDeps } from '../../fakes/usage-ports'
import { makeUsageProviders } from '../../helpers/query'
describe('Given injected off-peak dependencies', () => {
  const deps = (): FakeUsageDeps => ({ gateway: createFakeUsageGateway(), clock: createFakeUsageClock('2026-11-16T16:30:00Z'), scheduler: createFakeUsageScheduler() })
  it('When the optional schedule is omitted Then the existing provider works', () => {
    const { wrapper } = makeUsageProviders(deps())
    expect(renderHook(() => useOffpeakNotice('opencode', null), { wrapper }).result.current).toBeNull()
  })
  it('When the shared clock tick crosses a boundary Then state updates without scheduling a timer', () => {
    const ports = deps()
    const { wrapper } = makeUsageProviders({ ...ports, offpeak: { opencode: { windows: [{ start: '16:30', end: '22:30' }] } } })
    const hook = renderHook(({ nowIso }: { nowIso: string | null }) => ({ own: useOffpeakNotice('opencode', nowIso), other: useOffpeakNotice('ollama', nowIso) }), { wrapper, initialProps: { nowIso: '2026-11-16T16:29:59Z' as string | null } })
    expect(hook.result.current.own?.active).toBe(false)
    expect(hook.result.current.other).toBeNull()
    hook.rerender({ nowIso: '2026-11-16T16:30:00Z' })
    expect(hook.result.current.own?.active).toBe(true)
    hook.rerender({ nowIso: '2026-11-16T22:30:00Z' })
    expect(hook.result.current.own?.active).toBe(false)
    hook.rerender({ nowIso: null })
    expect(hook.result.current.own?.active).toBe(true)
    expect(ports.scheduler.pendingCount()).toBe(0)
  })
})
