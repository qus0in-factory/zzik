import '@ui/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import ky from 'ky'
import { parseFixtureUsageName } from '@domain/usage/fixture-name'
import App from '@ui/App'
import { createAppQueryClient } from '@app/query-client'
import { USAGE_QUERY_KEY_ROOT } from '@app/usage/usage-query'
import { ProviderOrderProvider } from '@app/usage/ProviderOrderContext'
import { ViewModeProvider } from '@app/usage/ViewModeContext'
import { createViewModeStore } from '@app/usage/view-mode-store'
import { createProviderOrderStore } from '@app/usage/provider-order-store'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { createDisabledHistoryDeps, HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { emptyChartViewBuilder } from '@app/usage/history/chart-view-input'
import type { ChartViewBuilder } from '@app/usage/history/chart-view-input'
import type { UsageDeps } from '@app/usage/UsageGatewayContext'
import { useUsageUiStore } from '@app/usage/usage-ui-store'
import { createBrowserClock, createBrowserScheduler } from '@infra/usage/browser-runtime'
import { browserLocalStorage, createLocalStorageOrderStore } from '@infra/usage/local-storage-order-store'
import { createLocalStorageViewModeStore } from '@infra/usage/local-storage-view-mode-store'
import { createFixtureUsageGateway } from '@infra/usage/fixture-usage-gateway'
import { createHttpUsageGateway } from '@infra/usage/http-usage-gateway'

// 조립 루트(ADR 0.2 D10, 스택 부록 A3~A5): infra 구현과 QueryClient를 만들어 app에 주입한다.
// - 프로덕션: 실 게이트웨이(HttpUsageGateway → /api/usage, ky 인스턴스 주입).
// - 개발(dev 빌드에서 ?fixture= 지정): 목 게이트웨이 + Zustand 픽스처 선택 상태.
const queryClient = createAppQueryClient()
const devFixtureRequested = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')

// 제공자 순서는 zustand 스토어(app)가 들고, 브라우저별 localStorage 저장은 infra 어댑터를 여기서 주입한다.
const orderStore = createProviderOrderStore(createLocalStorageOrderStore(browserLocalStorage()))
// 카드·목록 보기 방식도 같은 방식: zustand 스토어(app) + localStorage 어댑터 주입(infra).
const viewModeStore = createViewModeStore(createLocalStorageViewModeStore(browserLocalStorage()))

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

// 이력 계층(ADR 0.7): 기능 플래그 `__HISTORY_ENABLED__`(빌드 시 주입, 기본 꺼짐)가 꺼져 있으면 비활성 의존만 쓰고,
// 이력 infra(IndexedDB·HTTP 게이트웨이)·동기화 모듈은 동적 import 뒤에 있어 번들에서 빠진다(네트워크·IndexedDB 접근 0).
// 켜지면 게이트웨이·캐시·저장소 어댑터를 만들어 app에 주입한다. DEV 목 모드(?fixture=)는 합성 표본 픽스처 게이트웨이를 쓴다.
// 차트 뷰 빌더(T3)는 배선 때 buildView로 넣는다.
// 차트 뷰 빌더(T3)는 지연 청크에서만 온다. 버튼에 포인터·포커스가 닿는 preload로 미리 받고, 그전에는 빈 뷰를 돌려준다 —
// 메인 번들에는 차트 코드·uPlot이 들어가지 않는다.
let viewBuilder: ChartViewBuilder = emptyChartViewBuilder
async function loadHistoryDeps(): Promise<HistoryDeps> {
  if (!__HISTORY_ENABLED__) return createDisabledHistoryDeps()
  const [prefsModule, syncModule, storage, fixtureGateway, httpGateway, idbCache] = await Promise.all([
    import('@app/usage/history/chart-prefs-store'),
    import('@app/usage/history/sync-history'),
    import('@infra/usage/browser-storage'),
    import('@infra/usage/fixture-usage-history-gateway'),
    import('@infra/usage/http-usage-history-gateway'),
    import('@infra/usage/idb-history-cache'),
  ])
  const chartPrefs = prefsModule.createChartPrefsStore(storage.browserLocalKeyValue())
  storage.subscribeStorageKey(prefsModule.CHART_PREFS_KEY, () => void chartPrefs.persist.rehydrate()) // 다른 탭의 범례 설정 변경을 따라간다
  return {
    enabled: true,
    gateway: devFixtureRequested
      ? fixtureGateway.createFixtureUsageHistoryGateway()
      : httpGateway.createHttpUsageHistoryGateway(ky.create({ retry: 0, throwHttpErrors: false, redirect: 'manual', timeout: 10_000 })),
    cache: idbCache.createIdbHistoryCache(idbCache.browserIndexedDb()),
    session: storage.browserSessionKeyValue(),
    prefs: chartPrefs,
    budget: syncModule.createHistoryBudget({ now: () => Date.now() }),
    memory: new Map(),
    inflight: new Map(),
    buildView: (input) => viewBuilder(input),
    preload: () =>
      import('@ui/usage/history/lazy-chart').then((module) => {
        viewBuilder = module.buildChartView
      }),
    nowMs: () => Date.now(),
  }
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

async function start(): Promise<void> {
  const historyDeps = await loadHistoryDeps()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <UsageGatewayProvider deps={usageDeps}>
          <ProviderOrderProvider store={orderStore}>
            <ViewModeProvider store={viewModeStore}>
              <HistoryDepsProvider deps={historyDeps}>
                <App />
              </HistoryDepsProvider>
            </ViewModeProvider>
          </ProviderOrderProvider>
        </UsageGatewayProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
