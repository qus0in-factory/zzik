import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/view'
import { buildUsageLoadView } from './load-usage'
import { describeGatewayFailure, usageQueryOptions, UsageLoadError } from './usage-query'
import { composeLastSuccessText, composeStaleNoteText } from './usage-text'
import { useUsageDeps } from './UsageGatewayContext'

/** 화면이 관측하는 사용량 상태(0.2.1 계약 유지 — ui는 바뀌지 않는다). */
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

const USAGE_NOW_TICK_MS = 30_000

/**
 * 제공자 하나의 사용량을 TanStack Query로 구독하는 얇은 훅(스택 부록 A4, ADR 0.3 D8).
 *
 * - 캐시 키는 `['usage', provider]`다. 제공자마다 캐시·오류·폴링이 독립이라
 *   한쪽 실패가 다른 쪽 섹션을 바꾸지 않는다.
 * - 주기·가시성 정지·재시도·중복 병합은 Query 옵션과 클라이언트 기본값이 맡는다.
 * - 4상태 매핑: 데이터도 오류도 없음 → loading, 데이터+정상 → ready,
 *   데이터+(오류 또는 수집 판정 비정상) → stale, 데이터 없고 오류 → error.
 *
 * v5 관찰 동작(주석 정정, 이슈 #17): 데이터가 있는 상태의 재조회가 실패하면
 * observer의 `status`는 `'success'`로 남는다. 실패는 두 경로로 관측된다.
 *   1) `query.error` — Query가 마지막 실패를 state에 남긴다(같은 키의 다음 성공에서 지워진다).
 *   2) `refetch()`의 reject — 훅이 `refetchFailure`로 잡는다(observer가 error를 비우는 경우의 보완).
 * 그래서 두 경로를 모두 stale 매핑에 쓰고, 성공(dataUpdatedAt 변화)에서 보조 상태를 비운다.
 * 캐시에는 성공 결과(raw 응답 + 수집 메타)만 두고, 뷰는 now로 매번 다시 만든다
 * — 30초 틱마다 리셋 문구와 stale 판정이 재계산된다.
 */
export function useUsage(provider: UsageProvider): UsageUiStateValue {
  const deps = useUsageDeps()
  const query = useQuery({ ...usageQueryOptions(deps.gateway, provider) })
  const [nowIso, setNowIso] = useState<string>(() => deps.clock.nowIso())
  /** observer가 error를 비우는 경우를 보완하는 수동 재조회 실패(A4). */
  const [refetchFailure, setRefetchFailure] = useState<UsageLoadError | null>(null)

  // 상대 시각은 30초마다 다시 계산한다(ADR 0.2 D9). 제공자 섹션마다 자기 틱을 갖는다.
  useEffect(() => {
    let cancel = (): void => {}
    const scheduleTick = (): void => {
      cancel = deps.scheduler.schedule(USAGE_NOW_TICK_MS, () => {
        setNowIso(deps.clock.nowIso())
        scheduleTick()
      })
    }
    scheduleTick()
    return () => cancel()
  }, [deps])

  const view = useMemo(
    () => (query.data !== undefined ? buildUsageLoadView(query.data, new Date(nowIso), provider) : null),
    [query.data, nowIso, provider],
  )

  // 성공 데이터가 도착하면 수동 재조회 실패 표시를 지운다(다음 실패에서 다시 세팅된다).
  useEffect(() => {
    setRefetchFailure((prev) => (prev === null ? prev : null))
  }, [query.dataUpdatedAt])

  const queryErrorFound = query.error !== null && query.error !== undefined
  const effectiveError: UsageLoadError | null = queryErrorFound
    ? query.error instanceof UsageLoadError
      ? query.error
      : new UsageLoadError('api_error', null)
    : refetchFailure
  const errorMessage: string | null =
    effectiveError === null ? null : describeGatewayFailure(effectiveError.reason, effectiveError.code)

  const status: UsageUiStatus = useMemo(() => {
    if (view === null) return effectiveError === null ? 'loading' : 'error'
    if (effectiveError !== null || view.collectionOk === false) return 'stale'
    return 'ready'
  }, [view, effectiveError])

  const lastSuccessAt = view?.lastSuccessAt ?? null
  const state = useMemo<UsageUiState>(() => ({
    status,
    report: view?.report ?? null,
    lastSuccessAt,
    errorMessage,
    nowIso,
    lastSuccessText: composeLastSuccessText(lastSuccessAt, nowIso),
    staleNoteText: status === 'stale' ? composeStaleNoteText(lastSuccessAt, nowIso) : null,
  }), [status, view, lastSuccessAt, errorMessage, nowIso])

  // 수동 새로고침은 진행 중 호출을 취소하지 않는다(cancelRefetch: false → 합쳐진다).
  // 실패(취소·오류)는 refetchFailure로 잡아 stale 매핑에 쓴다.
  const refresh = useCallback((): Promise<void> => {
    return query
      .refetch({ cancelRefetch: false })
      .then(() => {
        setRefetchFailure((prev) => (prev === null ? prev : null))
      })
      .catch((error: unknown) => {
        setRefetchFailure(error instanceof UsageLoadError ? error : new UsageLoadError('api_error', null))
      })
  }, [query])

  return { state, refresh }
}
