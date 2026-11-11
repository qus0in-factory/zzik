import '@ui/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import ky from 'ky'
import { parseFixtureUsageName } from '@domain/usage/fixture-name'
import App from '@ui/App'
import { createAppQueryClient } from '@app/query-client'
import { USAGE_QUERY_KEY_ROOT } from '@app/usage/usage-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import type { UsageDeps } from '@app/usage/UsageGatewayContext'
import { useUsageUiStore } from '@app/usage/usage-ui-store'
import { createBrowserClock, createBrowserScheduler } from '@infra/usage/browser-runtime'
import { createFixtureUsageGateway } from '@infra/usage/fixture-usage-gateway'
import { createHttpUsageGateway } from '@infra/usage/http-usage-gateway'

// 조립 루트(ADR 0.2 D10, 스택 부록 A3~A5): infra 구현과 QueryClient를 만들어 app에 주입한다.
// - 프로덕션: 실 게이트웨이(HttpUsageGateway → /api/usage, ky 인스턴스 주입).
// - 개발(dev 빌드에서 ?fixture= 지정): 목 게이트웨이 + Zustand 픽스처 선택 상태.
const queryClient = createAppQueryClient()
const devFixtureRequested = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')

const usageDeps: UsageDeps = {
  clock: createBrowserClock(),
  scheduler: createBrowserScheduler(),
  gateway: devFixtureRequested
    ? createFixtureUsageGateway({ getFixtureName: () => useUsageUiStore.getState().fixtureName })
    : createHttpUsageGateway(
        ky.create({ retry: 0, throwHttpErrors: false, redirect: 'manual', timeout: 10_000 }),
        '/api/usage',
      ),
}

// 개발 목 모드에서 픽스처 선택이 바뀌면 캐시를 무효화해 다음 조회가 바뀐 시나리오를 가져온다.
if (devFixtureRequested) {
  let previous: string = parseFixtureUsageName(window.location.search)
  useUsageUiStore.subscribe((state) => {
    if (state.fixtureName !== previous) {
      previous = state.fixtureName
      void queryClient.invalidateQueries({ queryKey: USAGE_QUERY_KEY_ROOT })
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UsageGatewayProvider deps={usageDeps}>
        <App />
      </UsageGatewayProvider>
    </QueryClientProvider>
  </StrictMode>,
)
