// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { UsageClock, UsageGateway, UsageScheduler } from '@domain/usage/gateway'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'

/**
 * Query 테스트 헬퍼(스택 부록 A6). 운영용 createAppQueryClient()를 쓰지 않고
 * retry:false의 새 클라이언트를 테스트마다 만든다 — 재시도 정책이 테스트를 방해하지 않게.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // 포커스 관련 동작은 개별 테스트가 focusManager로 제어한다.
        refetchOnWindowFocus: true,
      },
    },
  })
}

export interface UsageProviderDeps {
  gateway: UsageGateway
  clock: UsageClock
  scheduler: UsageScheduler
}

export function makeUsageProviders(
  deps: UsageProviderDeps,
  client: QueryClient = createTestQueryClient(),
): { wrapper: (props: { children: ReactNode }) => ReactNode; client: QueryClient } {
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>
      <UsageGatewayProvider deps={deps}>{children}</UsageGatewayProvider>
    </QueryClientProvider>
  )
  return { wrapper, client }
}

/** ui 컴포넌트(App 등)를 사용량 의존과 함께 렌더한다. */
export function renderWithUsage(ui: ReactNode, deps: UsageProviderDeps, client: QueryClient = createTestQueryClient()): void {
  const { wrapper } = makeUsageProviders(deps, client)
  render(<UsageWrapperProvider wrapper={wrapper}>{ui}</UsageWrapperProvider>)
}

/** render의 wrapper 옵션을 쓸 수 있게 훅 provider를 하나의 컴포넌트로 묶는다. */
function UsageWrapperProvider({ wrapper, children }: { wrapper: (props: { children: ReactNode }) => ReactNode; children: ReactNode }): ReactNode {
  return wrapper({ children })
}
