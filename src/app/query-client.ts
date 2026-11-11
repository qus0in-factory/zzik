import { QueryClient } from '@tanstack/react-query'
import { shouldRetryUsage } from './usage/usage-query'

/**
 * 운영용 QueryClient(스택 부록 A4·A6). 재시도 정책은 훅 옵션이 아니라
 * 같은 기본 옵션에 둔다 — 테스트용 클라이언트(retry:false)가 정책을 덮으면서
 * 나머지 동작을 검증할 수 있게 하기 위해서다. 훅 테스트는 이 함수를 쓰지 않는다.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => shouldRetryUsage(failureCount, error),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchIntervalInBackground: false,
      },
    },
  })
}
