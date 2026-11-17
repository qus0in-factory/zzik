// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { createFixtureTrendGateway } from '@infra/trend/fixture-trend-gateway'
import { createTestQueryClient } from '../helpers/query'
import { MemoryRouter, useNavigate } from 'react-router'
import { TrendPage } from '@ui/TrendPage'

let observerCallback: IntersectionObserverCallback
class TestObserver {
  constructor(callback: IntersectionObserverCallback) { observerCallback = callback }
  observe() {}
  disconnect() {}
  unobserve() {}
}
function Navigate() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/trend#new-models')}>이동</button>
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Given trend section navigation', () => {
  it('When the free section is hidden Then only visible section links appear and back-to-top follows scrolling', () => {
    render(<MemoryRouter><TrendPage /></MemoryRouter>)
    const nav = screen.getByRole('navigation', { name: '트렌드 섹션' })
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/trend#links'])
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 })
    fireEvent.scroll(window)
    expect(screen.getByRole('button', { name: '맨 위로' })).toBeTruthy()
  })
  it('When the initial or changed hash targets a section Then it scrolls into view', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<QueryClientProvider client={createTestQueryClient()}><TrendGatewayProvider deps={{ enabled: true, gateway: createFixtureTrendGateway() }}><MemoryRouter initialEntries={['/trend#metrics']}><Navigate /><TrendPage /></MemoryRouter></TrendGatewayProvider></QueryClientProvider>)
    expect(scroll).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '이동' }))
    expect(scroll).toHaveBeenCalledTimes(2)
  })
  it('When an observed section becomes visible Then its link is current', () => {
    vi.stubGlobal('IntersectionObserver', TestObserver)
    render(<QueryClientProvider client={createTestQueryClient()}><TrendGatewayProvider deps={{ enabled: true, gateway: createFixtureTrendGateway() }}><MemoryRouter><TrendPage /></MemoryRouter></TrendGatewayProvider></QueryClientProvider>)
    const section = document.getElementById('new-models')!
    act(() => observerCallback([{ target: section, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(screen.getByRole('link', { name: '신규 모델' }).getAttribute('aria-current')).toBe('location')
  })
})
