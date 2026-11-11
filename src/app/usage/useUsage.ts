import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UsageReport } from '@domain/usage/view'
import { describeGatewayFailure, loadUsage } from './load-usage'
import type { UsageLoadResult } from './load-usage'
import { composeLastSuccessText, composeStaleNoteText } from './usage-text'
import { createUsagePoller } from './usage-poller'
import { useUsageDeps } from './UsageGatewayContext'

/** 화면이 관측하는 사용량 상태(시나리오 §2의 status/report/lastSuccessAt/errorMessage). */
export type UsageUiStatus = 'ready' | 'loading' | 'error' | 'stale'

export interface UsageUiState {
  status: UsageUiStatus
  report: UsageReport | null
  lastSuccessAt: string | null
  errorMessage: string | null
  /** 상대 시각 재계산용 현재 시각(30초마다 갱신, ADR 0.2 D9) */
  nowIso: string | null
  /** 상태 줄 문구(`마지막 수집 11:58 (2분 전)`) — app에서 계산 */
  lastSuccessText: string | null
  /** stale 안내 문구(`마지막 성공 2분 전`) — app에서 계산 */
  staleNoteText: string | null
}

export interface UsageUiStateValue {
  state: UsageUiState
  refresh: () => Promise<void>
}

const USAGE_POLL_INTERVAL_MS = 60_000
const USAGE_NOW_TICK_MS = 30_000

/**
 * usage-poller를 React 상태에 연결하는 얇은 훅(ADR 0.2 D11).
 * 마운트 시와 60초마다(탭이 보일 때만) 게이트웨이를 호출한다. 재조회가 실패하면
 * 마지막 보고서는 유지되고 stale로 바뀐다.
 */
export function useUsage(): UsageUiStateValue {
  const deps = useUsageDeps()
  const [state, setState] = useState<UsageUiState>(() => ({
    status: 'loading',
    report: null,
    lastSuccessAt: null,
    errorMessage: null,
    nowIso: deps.clock.nowIso(),
    lastSuccessText: null,
    staleNoteText: null,
  }))

  const handleResult = useCallback(
    (result: UsageLoadResult) => {
      setState((prev) => {
        const nowIso = deps.clock.nowIso()
        if (result.ok) {
          return {
            status: 'ready',
            report: result.report,
            lastSuccessAt: nowIso,
            errorMessage: null,
            nowIso,
            lastSuccessText: composeLastSuccessText(nowIso, nowIso),
            staleNoteText: null,
          }
        }
        const message = result.message ?? describeGatewayFailure(result.reason)
        if (prev.report) {
          return {
            ...prev,
            status: 'stale',
            errorMessage: message,
            nowIso,
            lastSuccessText: composeLastSuccessText(prev.lastSuccessAt, nowIso),
            staleNoteText: composeStaleNoteText(prev.lastSuccessAt, nowIso),
          }
        }
        return { ...prev, status: 'error', errorMessage: message, nowIso, lastSuccessText: null, staleNoteText: null }
      })
    },
    [deps],
  )

  const poller = useMemo(
    () =>
      createUsagePoller(
        {
          fetch: () => loadUsage(deps.gateway, { now: new Date(deps.clock.nowIso()) }),
          intervalMs: USAGE_POLL_INTERVAL_MS,
          scheduler: deps.scheduler,
          visibility: deps.visibility,
        },
        { onResult: handleResult },
      ),
    [deps, handleResult],
  )

  useEffect(() => {
    poller.start()
    return () => poller.stop()
  }, [poller])

  // 상대 시각은 30초마다 다시 계산한다(ADR 0.2 D9).
  useEffect(() => {
    let cancel = (): void => {}
    const scheduleTick = (): void => {
      cancel = deps.scheduler.schedule(USAGE_NOW_TICK_MS, () => {
        setState((prev) => {
          const nowIso = deps.clock.nowIso()
          return {
            ...prev,
            nowIso,
            lastSuccessText: composeLastSuccessText(prev.lastSuccessAt, nowIso),
            staleNoteText: prev.status === 'stale' ? composeStaleNoteText(prev.lastSuccessAt, nowIso) : null,
          }
        })
        scheduleTick()
      })
    }
    scheduleTick()
    return () => cancel()
  }, [deps])

  const refresh = useCallback(() => poller.refresh(), [poller])

  return { state, refresh }
}
