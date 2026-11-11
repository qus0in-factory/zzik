// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { useUsage } from '@app/usage/useUsage'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { makeUsageProviders, createTestQueryClient } from '../../helpers/query'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler, NOW_ISO } from '../../fakes/usage-ports'

afterEach(cleanup)

const SUCCESS = { ok: true, usage: normalRaw, collection: null, rawText: null } as const

const ENVELOPE_OK = {
  schema: 1, provider: 'claude', status: 'ok', called: true,
  runAt: NOW_ISO, fetchedAt: NOW_ISO, httpStatus: 200, retryAt: null,
  tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 300, collectorVersion: '0.2.0', rawOmitted: null,
} as const

const ENVELOPE_RATE_LIMITED = {
  schema: 1, provider: 'claude', status: 'rate_limited', called: false,
  runAt: NOW_ISO, fetchedAt: NOW_ISO, httpStatus: null, retryAt: null,
  tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 300, collectorVersion: '0.2.0', rawOmitted: null,
} as const

function makeHarness() {
  const gateway = createFakeUsageGateway()
  const clock = createFakeUsageClock()
  const scheduler = createFakeUsageScheduler()
  const providers = makeUsageProviders({ gateway, clock, scheduler })
  return { gateway, clock, scheduler, client: providers.client, wrapper: providers.wrapper }
}

describe('Given the useUsage hook with TanStack Query', () => {
  it('When the first load succeeds then the state moves from loading to ready (A4 4상태)', async () => {
    const harness = makeHarness()
    harness.gateway.pushResult(SUCCESS)
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.state.report?.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 37 })
    expect(result.current.state.errorMessage).toBeNull()
  })

  it('When a later load fails then the state becomes stale and the last report is kept (A4)', async () => {
    const harness = makeHarness()
    harness.gateway.pushResult(SUCCESS)
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const report = result.current.state.report

    harness.gateway.pushResult({ ok: false, reason: 'api_error', message: null })
    await act(async () => {
      await result.current.refresh()
    })
    // v5는 데이터가 있을 때 재조회 실패를 error 상태로 바꾸지 않는다 — 훅이 잡아 stale로 매핑한다.
    await waitFor(() => expect(result.current.state.status).toBe('stale'))
    expect(result.current.state.report).toBe(report)
    expect(result.current.state.errorMessage).toContain('불러오지 못했습니다')
  })

  it('When the first load fails with no data then the state is error (A4 4상태)', async () => {
    const harness = makeHarness()
    harness.gateway.pushResult({ ok: false, reason: 'network_error', message: null })
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state.report).toBeNull()
    expect(result.current.state.errorMessage).toContain('네트워크')
  })

  it('When the collection judgment is not ok then ready becomes stale (수집 판정 비정상)', async () => {
    const harness = makeHarness()
    harness.gateway.pushResult({ ok: true, usage: normalRaw, collection: ENVELOPE_RATE_LIMITED, rawText: null })
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('stale'))
    expect(result.current.state.report?.windows[0]).toMatchObject({ usedPercent: 37 })
  })

  it('When refresh is called twice while a request is pending then the gateway is called once (A4 병합)', async () => {
    const harness = makeHarness()
    const deferred = harness.gateway.pushDeferred()
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    await act(async () => {
      first = result.current.refresh()
      second = result.current.refresh()
    })
    // 마운트 fetch와 수동 refresh가 같은 queryKey의 진행 중 실행으로 합쳐진다(cancelRefetch: false).
    expect(harness.gateway.calls).toBe(1)
    await act(async () => {
      deferred.resolve(SUCCESS)
      await Promise.all([first, second].filter(Boolean) as Promise<void>[])
    })
    expect(harness.gateway.calls).toBe(1)
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
  })
})

describe('Given the 30 second now tick', () => {
  it('When the tick fires then the reset wording is recomputed with the new time (A4)', async () => {
    const harness = makeHarness()
    harness.gateway.pushResult({ ok: true, usage: normalRaw, collection: ENVELOPE_OK, rawText: null })
    const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    // 절대 시각 부분은 실행 기기의 시간대를 따른다(ko-KR HH:MM) — 기대값도 같은 계산으로 만든다.
    const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    const before = `마지막 수집 ${hhmm('2026-11-11T12:00:00.000Z')} (방금 전)`
    const after = `마지막 수집 ${hhmm('2026-11-11T12:00:00.000Z')} (2분 전)`
    expect(result.current.state.lastSuccessText).toBe(before)

    harness.clock.setIso('2026-11-11T12:02:00.000Z')
    act(() => {
      harness.scheduler.runScheduledAt(30_000)
    })
    expect(result.current.state.nowIso).toBe('2026-11-11T12:02:00.000Z')
    expect(result.current.state.lastSuccessText).toBe(after)
  })
})

describe('Given Query polling and window focus (가짜 타이머는 Query 주기 테스트에만)', () => {
  it('When the interval elapses while visible then it refetches every 60 seconds', async () => {
    vi.useFakeTimers()
    try {
      const harness = makeHarness()
      harness.gateway.pushResult(SUCCESS)
      harness.gateway.pushResult(SUCCESS)
      const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(harness.gateway.calls).toBe(1)
      expect(result.current.state.status).toBe('ready')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(harness.gateway.calls).toBe(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(harness.gateway.calls).toBe(3)
    } finally {
      vi.useRealTimers()
      cleanup()
    }
  })

  it('When the tab is hidden then refetching pauses and resumes with an immediate call on return', async () => {
    vi.useFakeTimers()
    try {
      const harness = makeHarness()
      harness.gateway.pushResult(SUCCESS)
      harness.gateway.pushResult(SUCCESS)
      const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(harness.gateway.calls).toBe(1)
      expect(result.current.state.status).toBe('ready')

      focusManager.setFocused(false)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(180_000)
      })
      expect(harness.gateway.calls).toBe(1) // 숨김 중에는 주기 호출이 없다(refetchIntervalInBackground: false)

      focusManager.setFocused(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      // 데이터는 30초 staleTime보다 오래되어 복귀 즉시 재조회된다(refetchOnWindowFocus: true).
      expect(harness.gateway.calls).toBe(2)
      expect(result.current.state.status).toBe('ready')
    } finally {
      focusManager.setFocused(undefined)
      vi.useRealTimers()
      cleanup()
    }
  })

  it('When a session expired error stops polling then no further calls happen (A4)', async () => {
    vi.useFakeTimers()
    try {
      const harness = makeHarness()
      harness.gateway.pushResult({ ok: false, reason: 'session_expired', message: null })
      const { result } = renderHook(() => useUsage(), { wrapper: harness.wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(harness.gateway.calls).toBe(1)
      expect(result.current.state.status).toBe('error')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000)
      })
      // session_expired에서는 refetchInterval이 false가 되어 다시 호출하지 않는다.
      expect(harness.gateway.calls).toBe(1)
    } finally {
      vi.useRealTimers()
      cleanup()
    }
  })
})
