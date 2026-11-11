import '@ui/index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@ui/App'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import type { UsageDeps } from '@app/usage/UsageGatewayContext'
import { createFixtureUsageGateway } from '@infra/usage/fixture-usage-gateway'
import { createBrowserClock, createBrowserScheduler, createBrowserVisibility } from '@infra/usage/browser-runtime'

// 조립 루트: infra 구현을 만들어 app에 주입한다(ADR 0.2 D10·D11).
// 0.2.1은 목 게이트웨이(?fixture=normal|warn|limited|unknown-keys|error|loading)이고
// 0.2에서 http-usage-gateway로 교체된다.
const usageDeps: UsageDeps = {
  gateway: createFixtureUsageGateway(),
  clock: createBrowserClock(),
  scheduler: createBrowserScheduler(),
  visibility: createBrowserVisibility(),
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UsageGatewayProvider deps={usageDeps}>
      <App />
    </UsageGatewayProvider>
  </StrictMode>,
)
