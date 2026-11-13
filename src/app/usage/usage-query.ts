import { queryOptions } from '@tanstack/react-query'
import type { Query } from '@tanstack/react-query'
import type { UsageGateway, UsageGatewayResult, UsageGatewaySuccess, UsageGatewayFailureReason } from '@domain/usage/gateway'
import type { UsageProvider } from '@domain/usage/providers'

/** 주기(스택 부록 A4): 900초 refetchInterval (ADR 0.5 Neon Free). 제공자마다 독립으로 돈다. */
export const USAGE_POLL_INTERVAL_MS = 900_000
/** 세션 만료로 폴링을 멈출 때 refetchInterval이 되돌리는 값. */
export const POLLING_STOPPED = false
/** 전체 무효화에 쓰는 접두 키. 제공자별 키는 이 접두 아래에 있다(D8). */
export const USAGE_QUERY_KEY_ROOT = ['usage'] as const

/** `['usage', provider]` — 제공자마다 캐시·오류·폴링이 분리된다. */
export function usageQueryKey(provider: UsageProvider): readonly ['usage', UsageProvider] {
  return [USAGE_QUERY_KEY_ROOT[0], provider] as const
}

/**
 * Worker가 돌려주는 오류 코드 → 사용자 문구(이슈 #17).
 * 원시 코드(`invalid_response`, `http_502` 등)를 화면에 그대로 노출하지 않는다.
 */
export const USAGE_ERROR_CODE_TEXT: Record<string, string> = {
  request_timeout: '사용량 서버의 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
  invalid_response: '사용량 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.',
  snapshot_corrupt: '저장된 사용량 값이 손상되었습니다. 수집기가 다음 값을 쓸 때까지 기다려 주세요.',
  storage_unavailable: '저장된 사용량을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.',
  jwks_unavailable: '로그인 확인 키를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  misconfigured: '서버 설정이 완료되지 않았습니다. 설정을 확인해 주세요.',
  unauthorized: '로그인이 필요합니다. 페이지를 새로 고친 뒤 다시 로그인해 주세요.',
  not_found: '요청한 제공자의 사용량을 찾을 수 없습니다.',
  method_not_allowed: '지원하지 않는 요청입니다.',
}

const HTTP_CODE = /^http_(\d{3})$/
const CODE_LIKE = /^[a-z0-9_]+$/

/**
 * 실패 이유와 원시 코드를 사용자 문구로 바꾼다.
 * - 알려진 코드는 표에서, `http_<status>`는 상태대별 문구로 바꾼다.
 * - 사람이 쓴 문장(공백/한글 포함)은 그대로 쓴다.
 * - 모르는 코드 모양이면 이유별 기본 문구로 떨어뜨린다(원시 코드 노출 금지).
 */
export function describeGatewayFailure(reason: UsageGatewayFailureReason, code: string | null = null): string {
  const mapped = code === null ? undefined : USAGE_ERROR_CODE_TEXT[code]
  if (mapped !== undefined) return mapped

  const http = code === null ? null : HTTP_CODE.exec(code)
  if (http !== null) {
    const status = Number(http[1])
    return status >= 500
      ? '서버에서 사용량을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '사용량 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }

  if (reason === 'session_expired') return 'Access 세션이 만료되었습니다. 페이지를 새로 고친 뒤 다시 로그인해 주세요.'
  if (reason === 'network_error') return '네트워크에 연결할 수 없습니다.'

  // 사람이 쓴 메시지는 그대로 보여 준다. 코드 모양이면 노출하지 않는다.
  if (code !== null && code.length > 0 && !CODE_LIKE.test(code)) return code
  return '사용량을 불러오지 못했습니다.'
}

/**
 * Query의 오류·재시도 모델은 예외 기반이다(스택 부록 A4). 게이트웨이는 결과 유니온을
 * 유지하되 이 어댑터만 ok:false를 UsageLoadError로 바꾼다.
 * `code`는 게이트웨이가 준 원시 코드(없으면 null)이고 `message`는 사용자 문구다.
 */
export class UsageLoadError extends Error {
  readonly reason: UsageGatewayFailureReason
  readonly code: string | null
  constructor(reason: UsageGatewayFailureReason, code: string | null) {
    super(describeGatewayFailure(reason, code))
    this.name = 'UsageLoadError'
    this.reason = reason
    this.code = code
  }
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
 * 제공자 하나의 조회 Query 옵션. 주기, 가시성 정지(refetchIntervalInBackground: false),
 * 복귀 즉시 조회(refetchOnWindowFocus), 중복 병합(같은 키 병합)을 맡는다.
 * @param gateway 게이트웨이 포트. queryFn은 infra의 fetch를 직접 부르지 않는다.
 * @param provider 조회 대상. 키가 `['usage', provider]`라 제공자끼리 섞이지 않는다.
 */
export function usageQueryOptions(gateway: UsageGateway, provider: UsageProvider) {
  return queryOptions({
    queryKey: usageQueryKey(provider),
    queryFn: async (): Promise<UsageGatewaySuccess> => {
      const result: UsageGatewayResult = await gateway.fetchUsage(provider)
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
