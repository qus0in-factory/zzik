// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { AppRoutes } from '@ui/AppRoutes'
import { SiteHeader } from '@ui/SiteHeader'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue } from '../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../fakes/usage-ports'
import { makeUsageProviders } from '../helpers/query'

afterEach(cleanup)

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>
}

function renderAt(entry: string, navigate?: (url: string) => void) {
  const gateway = createFakeUsageGateway()
  const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <providers.wrapper>
        <AppRoutes navigate={navigate} />
        <LocationProbe />
      </providers.wrapper>
    </MemoryRouter>,
  )
  return { gateway }
}

describe('Given the usage/trend router', () => {
  it('When / is requested Then renders the landing page without navigating away', async () => {
    const navigate = vi.fn()
    const { gateway } = renderAt('/', navigate)
    expect(await screen.findByText('AI 사용량을 한곳에서')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(gateway.calls).toBe(0)
  })

  it('When / has a fixture query and hash Then keeps the landing location without navigating', async () => {
    const navigate = vi.fn()
    renderAt('/?fixture=normal#usage-claude', navigate)
    expect(await screen.findByText('AI 사용량을 한곳에서')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/?fixture=normal#usage-claude')
  })

  it('When an unknown path is requested Then full-navigates to /usage with the query and hash', async () => {
    const navigate = vi.fn()
    renderAt('/unknown?fixture=normal#usage-claude', navigate)
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith('/usage?fixture=normal#usage-claude'))
  })

  it('When /usage is requested Then renders the existing usage screen and marks usage current', async () => {
    renderAt('/usage')
    expect(screen.getByTestId('location').textContent).toBe('/usage')
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBeNull()
    await screen.findByTestId('usage-section-claude')
  })

  it('When /trend is requested Then renders only the nav and external links without data calls', () => {
    const { gateway } = renderAt('/trend')
    expect(screen.getByTestId('location').textContent).toBe('/trend')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBeNull()
    expect(screen.queryByText('트렌드 화면은 아직 준비 중입니다.')).toBeNull()
    const links = within(screen.getByRole('list', { name: '트렌드 참고 링크' })).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://artificialanalysis.ai/leaderboards/models',
      'https://cognition.com/frontiercode',
      'https://arena.ai/leaderboard',
      'https://openrouter.ai/rankings',
      'https://opencode.ai/ko/data',
    ])
    expect(screen.queryAllByTestId(/^usage-section-/)).toHaveLength(0)
    expect(screen.getByTestId('app-version').textContent).toBe(`v${__APP_VERSION__}`)
    expect(screen.getByTestId('back-to-top-shell')).toBeTruthy()
    expect(gateway.calls).toBe(0)
  })

  it('When the nav is clicked Then the query survives the usage → trend → usage round trip', async () => {
    renderAt('/usage?fixture=normal')
    await screen.findByTestId('usage-section-claude')
    fireEvent.click(screen.getByRole('link', { name: '트렌드' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/trend?fixture=normal'))
    fireEvent.click(screen.getByRole('link', { name: '사용량' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/usage?fixture=normal'))
  })

  it('When history is enabled and /trend is loaded Then no usage or history request starts', () => {
    const usageGateway = createFakeUsageGateway()
    const historyGateway = createFakeHistoryGateway({ claude: createFakeHistoryServer('claude', []) })
    const historyDeps: HistoryDeps = {
      enabled: true,
      gateway: historyGateway,
      cache: createFakeHistoryCache(),
      session: createMemoryKeyValue(),
      prefs: createChartPrefsStore(createMemoryKeyValue()),
      budget: createHistoryBudget({ now: () => Date.now() }),
      memory: new Map(),
      inflight: new Map(),
      nowMs: () => Date.now(),
    }
    const providers = makeUsageProviders({ gateway: usageGateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    render(
      <MemoryRouter initialEntries={['/trend']}>
        <providers.wrapper>
          <HistoryDepsProvider deps={historyDeps}>
            <AppRoutes />
            <LocationProbe />
          </HistoryDepsProvider>
        </providers.wrapper>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('location').textContent).toBe('/trend')
    expect(usageGateway.calls).toBe(0)
    expect(historyGateway.queries).toHaveLength(0)
    expect(historyGateway.summaryCalls).toBe(0)
  })

  it('When the nav renders Then both items stay on one line', () => {
    renderAt('/usage')
    const nav = screen.getByRole('navigation', { name: '주요 화면' })
    expect(nav.className).toContain('whitespace-nowrap')
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['사용량', '트렌드'])
    for (const link of links) expect(link.className).toContain('whitespace-nowrap')
  })
})

describe('Given the nav active marker', () => {
  it('When the path is / Then neither nav item is current', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SiteHeader />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBeNull()
  })

  it.each(['/usage', '/usage/', '/USAGE'])('When the path is %s Then usage is current', (entry) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <SiteHeader />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBeNull()
    cleanup()
  })

  it('When the path is /trend/ Then trend is current', () => {
    render(
      <MemoryRouter initialEntries={['/trend/']}>
        <SiteHeader />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBeNull()
  })
})
