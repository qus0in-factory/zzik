// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useUsage } from '@app/usage/useUsage'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler, createFakeUsageVisibility, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

function makeHarness() {
  const gateway = createFakeUsageGateway()
  const clock = createFakeUsageClock()
  const scheduler = createFakeUsageScheduler()
  const visibility = createFakeUsageVisibility()
  const deps = { gateway, clock, scheduler, visibility }
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <UsageGatewayProvider deps={deps}>{children}</UsageGatewayProvider>
  )
  return { gateway, clock, scheduler, visibility, wrapper }
}

describe('Given the useUsage hook', () => {
  it('When the first load succeeds then the state moves from loading to ready (U11)', async () => {
    const { gateway, wrapper } = makeHarness()
    gateway.pushResult({ ok: true, usage: normalRaw })
    const { result } = renderHook(() => useUsage(), { wrapper })
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state.report).not.toBeNull()
    expect(result.current.state.report?.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 37 })
    expect(result.current.state.lastSuccessAt).toBe(NOW_ISO)
    expect(result.current.state.errorMessage).toBeNull()
  })

  it('When a later load fails then the state becomes stale and the report is kept (U11)', async () => {
    const { gateway, clock, wrapper } = makeHarness()
    gateway.pushResult({ ok: true, usage: normalRaw })
    const { result } = renderHook(() => useUsage(), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const report = result.current.state.report

    gateway.pushResult({ ok: false, reason: 'api_error', message: '사용량을 불러오지 못했습니다' })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.state.status).toBe('stale')
    expect(result.current.state.report).toBe(report)
    expect(result.current.state.errorMessage).toBe('사용량을 불러오지 못했습니다')

    gateway.pushResult({ ok: true, usage: normalRaw })
    clock.setIso('2026-11-11T12:05:00.000Z')
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.state.status).toBe('ready')
    expect(result.current.state.lastSuccessAt).toBe('2026-11-11T12:05:00.000Z')
  })

  it('When the first load fails with no report then the state becomes error', async () => {
    const { gateway, wrapper } = makeHarness()
    gateway.pushResult({ ok: false, reason: 'network_error', message: null })
    const { result } = renderHook(() => useUsage(), { wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state.report).toBeNull()
    expect(result.current.state.errorMessage).toBeTruthy()
  })

  it('When refresh is called twice while a request is pending then the gateway is called once (U12)', async () => {
    const { gateway, wrapper } = makeHarness()
    const deferred = gateway.pushDeferred()
    const { result } = renderHook(() => useUsage(), { wrapper })
    // 마운트 fetch가 먼저 지연 요청을 잡는다(진행 중 요청 1개).
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    await act(async () => {
      first = result.current.refresh()
      second = result.current.refresh()
    })
    expect(gateway.calls).toBe(1)
    act(() => {
      deferred.resolve({ ok: true, usage: normalRaw })
    })
    await act(async () => {
      await Promise.all([first, second].filter(Boolean) as Promise<void>[])
    })
    expect(gateway.calls).toBe(1)
    expect(result.current.state.status).toBe('ready')
    expect(result.current.state.lastSuccessAt).toBe(NOW_ISO)
  })
})
