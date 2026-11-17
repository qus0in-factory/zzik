// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '@ui/AppRoutes'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../fakes/usage-ports'
import { makeUsageProviders } from '../helpers/query'

afterEach(cleanup)

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderAt(entry: string) {
  const gateway = createFakeUsageGateway()
  const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
  render(
    <MemoryRouter initialEntries={[entry]}>
      <providers.wrapper>
        <AppRoutes />
        <LocationProbe />
      </providers.wrapper>
    </MemoryRouter>,
  )
  return { gateway }
}

describe('Given the usage/trend router', () => {
  it('When / is requested Then replaces the URL with /usage', async () => {
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/usage'))
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBeNull()
  })

  it('When / has a fixture query Then the redirect keeps it', async () => {
    renderAt('/?fixture=normal')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/usage?fixture=normal'))
  })

  it('When an unknown path is requested Then replaces it with /usage and keeps the query', async () => {
    renderAt('/unknown?fixture=normal')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/usage?fixture=normal'))
  })

  it('When /usage is requested Then renders the existing usage screen and marks usage current', async () => {
    renderAt('/usage')
    expect(screen.getByTestId('location').textContent).toBe('/usage')
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBeNull()
    await screen.findByTestId('usage-section-claude')
  })

  it('When /trend is requested Then renders only the nav and empty state without data calls', () => {
    const { gateway } = renderAt('/trend')
    expect(screen.getByTestId('location').textContent).toBe('/trend')
    expect(screen.getByRole('link', { name: '트렌드' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '사용량' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('트렌드 화면은 아직 준비 중입니다.')).toBeTruthy()
    expect(screen.queryAllByTestId(/^usage-section-/)).toHaveLength(0)
    expect(screen.queryByTestId('app-version')).toBeNull()
    expect(screen.queryByTestId('back-to-top-shell')).toBeNull()
    expect(gateway.calls).toBe(0)
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
