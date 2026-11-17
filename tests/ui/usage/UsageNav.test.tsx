// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AaTrendGatewayProvider } from '@app/trend/AaTrendContext'
import { ProviderOrderProvider } from '@app/usage/ProviderOrderContext'
import { createProviderOrderStore } from '@app/usage/provider-order-store'
import type { UsageProvider } from '@domain/usage/providers'
import { UsageSectionNav } from '@ui/usage/UsageSectionNav'

afterEach(cleanup)

function renderNav(options: { customOrder?: string[]; hiddenProviders?: UsageProvider[]; aaEnabled?: boolean } = {}) {
  const orderStore = createProviderOrderStore({
    load: () => options.customOrder ?? null,
    save: () => {},
    clear: () => {},
  })
  render(
    <ProviderOrderProvider store={orderStore}>
      <AaTrendGatewayProvider
        deps={{
          enabled: options.aaEnabled ?? true,
          gateway: { async fetchAaTrend() { return { ok: false, reason: 'not_ready', message: 'not_ready' } } },
        }}
      >
        <MemoryRouter initialEntries={['/usage']}>
          <UsageSectionNav hiddenProviders={options.hiddenProviders} />
        </MemoryRouter>
      </AaTrendGatewayProvider>
    </ProviderOrderProvider>,
  )
}

describe('Given UsageSectionNav for /usage', () => {
  it('When the current section changes Then scrolls the active link into view', () => {
    renderNav()
    const nav = screen.getByRole('navigation', { name: '사용량 섹션' })
    const links = within(nav).getAllByRole('link')
    const scrollIntoView = vi.fn()
    links[1]!.scrollIntoView = scrollIntoView

    fireEvent.click(links[1]!)

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('When rendered with custom order, hidden providers, and AA trend enabled Then lists visible providers in order followed by Trend and highlights current', () => {
    renderNav({
      customOrder: ['codex', 'claude', 'antigravity', 'opencode', 'grok', 'ollama'],
      hiddenProviders: ['grok'],
      aaEnabled: true,
    })
    const nav = screen.getByRole('navigation', { name: '사용량 섹션' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((el) => el.getAttribute('href'))).toEqual([
      '/usage#usage-codex',
      '/usage#usage-claude',
      '/usage#usage-antigravity',
      '/usage#usage-opencode',
      '/usage#usage-ollama',
      '/usage#trend',
    ])
    expect(links[0]?.getAttribute('aria-current')).toBe('location')
    expect(links[1]?.getAttribute('aria-current')).toBeNull()

    fireEvent.click(links[1]!)
    expect(links[1]?.getAttribute('aria-current')).toBe('location')
    expect(links[0]?.getAttribute('aria-current')).toBeNull()
  })

  it('When AA trend is disabled Then omits the Trend link', () => {
    renderNav({ aaEnabled: false })
    const nav = screen.getByRole('navigation', { name: '사용량 섹션' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((el) => el.getAttribute('href'))).not.toContain('/usage#trend')
  })
})
