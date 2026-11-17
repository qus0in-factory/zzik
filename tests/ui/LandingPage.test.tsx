// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { AppRoutes } from '@ui/AppRoutes'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue } from '../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../fakes/usage-ports'
import { makeUsageProviders } from '../helpers/query'

afterEach(cleanup)

function historyDeps(): { deps: HistoryDeps; gateway: ReturnType<typeof createFakeHistoryGateway> } {
  const gateway = createFakeHistoryGateway({ claude: createFakeHistoryServer('claude', []) })
  return {
    gateway,
    deps: {
      enabled: true,
      gateway,
      cache: createFakeHistoryCache(),
      session: createMemoryKeyValue(),
      prefs: createChartPrefsStore(createMemoryKeyValue()),
      budget: createHistoryBudget({ now: () => Date.now() }),
      memory: new Map(),
      inflight: new Map(),
      nowMs: () => Date.now(),
    },
  }
}

describe('Given the public landing page', () => {
  it('When it renders Then shows the intro, architecture and four fixture screenshots without any data call', async () => {
    const usageGateway = createFakeUsageGateway()
    const history = historyDeps()
    const providers = makeUsageProviders({ gateway: usageGateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    render(
      <MemoryRouter initialEntries={['/']}>
        <providers.wrapper>
          <HistoryDepsProvider deps={history.deps}>
            <AppRoutes />
          </HistoryDepsProvider>
        </providers.wrapper>
      </MemoryRouter>,
    )

    expect(await screen.findByText('AI 사용량을 한곳에서')).toBeTruthy()
    expect(screen.getByText('개인 사용량 대시보드')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '아키텍처' })).toBeTruthy()
    expect(screen.getByText(/README 아키텍처 절/)).toBeTruthy()
    expect(document.querySelectorAll('.landing-architecture > svg')).toHaveLength(2)
    expect(document.querySelector('.landing-architecture.hidden')).not.toBeNull()
    expect(document.querySelector('.landing-architecture.sm\\:hidden')).not.toBeNull()

    const screenshots = [
      ['사용량 · 데스크톱', '/screenshots/usage-desktop.webp'],
      ['사용량 · 모바일', '/screenshots/usage-mobile.webp'],
      ['사용량 · 차트', '/screenshots/usage-chart.webp'],
      ['트렌드', '/screenshots/trend.webp'],
    ] as const
    for (const [label, src] of screenshots) {
      const image = screen.getByAltText(`${label} 화면 (합성 fixture 데이터)`)
      expect(image.getAttribute('src')).toBe(src)
      expect(image.getAttribute('loading')).toBe('lazy')
    }

    expect(screen.getByRole('link', { name: '사용량' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '트렌드' })).toBeTruthy()
    expect(screen.getByTestId('home-link').getAttribute('href')).toBe('/')
    expect(screen.queryByTestId(/^usage-section-/)).toBeNull()
    expect(usageGateway.calls).toBe(0)
    expect(history.gateway.queries).toHaveLength(0)
    expect(history.gateway.summaryCalls).toBe(0)
  })
})
