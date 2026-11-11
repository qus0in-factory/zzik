import { queryOptions } from '@tanstack/react-query'
import type { Query } from '@tanstack/react-query'
import type { UsageGateway, UsageGatewayResult, UsageGatewaySuccess, UsageGatewayFailureReason } from '@domain/usage/gateway'

/** 주기(스택 부록 A4): 60초 refetchInterval. */
export const USAGE_POLL_INTERVAL_MS = 60_000
/** 세션 만료로 폴링을 멈출 때 refetchInterval이 되돌리는 값. */
export const POLLING_STOPPED = false

export const usageQueryKey = ['usage', 'claude'] as const

/**
 * Query의 오류·재시도 모델은 예외 기반이다(스택 부록 A4). 게이트웨이는 결과 유니온을
 * 유지하되 이 어댑터만 ok:false를 UsageLoadError로 바꾼다.
 */
export class UsageLoadError extends Error {
  readonly reason: UsageGatewayFailureReason
  constructor(reason: UsageGatewayFailureReason, message: string | null) {
    super(message ?? describeGatewayFailure(reason))
    this.name = 'UsageLoadError'
    this.reason = reason
  }
}

/** 실패 이유의 기본 안내 문구. 게이트웨이가 준 message가 없을 때 쓴다. */
export function describeGatewayFailure(reason: UsageGatewayFailureReason): string {
  if (reason === 'session_expired') return 'Access 세션이 만료되었습니다. 페이지를 새로 고친 뒤 다시 로그인해 주세요.'
  if (reason === 'network_error') return '네트워크에 연결할 수 없습니다.'
  return '사용량을 불러오지 못했습니다.'
}

/**
 * 재시도 정책(스택 부록 A4): session_expired·api_error는 재시도하지 않고
 * 다음 주기를 기다린다. network_error만 2회까지.
 * 옵션이 아니라 createAppQueryClient()의 기본에 둔다 — 테스트 클라이언트의
 * retry:false가 이 정책을 덮을 수 있어야 하기 때문이다.
 * @param failureCount 지금까지의 재시도 횟수(0부터)
 */
export function shouldRetryUsage(failureCount: number, error: unknown): boolean {
  if (!(error instanceof UsageLoadError)) return false
  return error.reason === 'network_error' && failureCount < 2
}

function isSessionExpired(error: unknown): boolean {
  return error instanceof UsageLoadError && error.reason === 'session_expired'
}

/**
 * usage 조회의 Query 옵션. 주기, 가시성 정지(refetchIntervalInBackground: false),
 * 복귀 즉시 조회(refetchOnWindowFocus), 중복 병합(Query의 같은 키 병합)을 맡는다.
 * @param gateway 게이트웨이 포트. queryFn은 infra의 fetch를 직접 부르지 않는다.
 */
export function usageQueryOptions(gateway: UsageGateway) {
  return queryOptions({
    queryKey: usageQueryKey,
    queryFn: async (): Promise<UsageGatewaySuccess> => {
      const result: UsageGatewayResult = await gateway.fetchUsage()
      if (result.ok !== true) throw new UsageLoadError(result.reason, result.message)
      return result
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (query: Query<UsageGatewaySuccess, UsageLoadError>) =>
      isSessionExpired(query.state.error) ? (POLLING_STOPPED as false) : USAGE_POLL_INTERVAL_MS,
  })
}
