// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { TrendGateway } from '@domain/trend/gateway'
import type { TrendSectionPayload } from '@shared/trend-contract'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { TrendPage } from '@ui/TrendPage'
import payload from '../../fixtures/trend/new-models.payload.json'
import { createDeferred } from '../../fakes/usage-ports'
import { createTestQueryClient } from '../../helpers/query'

const fixture = payload as TrendSectionPayload

afterEach(cleanup)

function gateway(fetchSection: TrendGateway['fetchSection']): TrendGateway {
  return { fetchSection }
}

function renderPage(fetchSection: TrendGateway['fetchSection']) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TrendGatewayProvider deps={{ gateway: gateway(fetchSection), enabled: true }}>
        <MemoryRouter initialEntries={['/trend']}>
          <TrendPage />
        </MemoryRouter>
      </TrendGatewayProvider>
    </QueryClientProvider>,
  )
}

describe('Given the recent new-models section on /trend', () => {
  it('When the section is loaded Then renders items, source/updated time and keeps the five reference links', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderPage(async () => ({ ok: true, value: fixture }))
    const section = within(screen.getByTestId('trend-new-models'))
    expect(await section.findByText('Claude Fable 5.2')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '신규 모델' })).toBeTruthy()
    expect(section.getByText('Qwen4 Max')).toBeTruthy()
    expect(section.getByText('HY4 Flash')).toBeTruthy()
    expect(section.queryByText('AA')).toBeNull()
    expect(section.getAllByText('OpenRouter')).toHaveLength(3)
    expect(section.getAllByText('출시 2026-11-16')).toHaveLength(2)
    expect(section.getAllByText('제공 2곳')).toHaveLength(2)
    expect(section.getByText(/출처 models\.dev · OpenRouter · 갱신/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '참고 링크' })).toBeTruthy()
    const links = screen.getByRole('list', { name: '트렌드 참고 링크' })
    expect(within(links).getAllByRole('link')).toHaveLength(5)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('When the section is loading Then shows the loading state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<TrendGateway['fetchSection']>>>()
    renderPage(() => deferred.promise)
    expect(await screen.findByText('새 모델을 불러오는 중…')).toBeTruthy()
  })

  it('When the section fails Then shows an error with retry; not_ready is an empty state', async () => {
    renderPage(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    const section = within(screen.getByTestId('trend-new-models'))
    const alert = await section.findByRole('alert')
    expect(alert.textContent).toContain('새 모델을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPage(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    expect(await screen.findByText('최근 7일 안에 새로 등록된 모델이 없습니다.')).toBeTruthy()
    expect(within(screen.getByTestId('trend-new-models')).queryByRole('alert')).toBeNull()
  })

  it('When the section payload has no items Then shows the empty state', async () => {
    renderPage(async () => ({ ok: true, value: { ...fixture, items: [] } }))
    expect(await screen.findByText('최근 7일 안에 새로 등록된 모델이 없습니다.')).toBeTruthy()
  })

  it('When more than 6 items arrive Then shows latest 6 first, reveals 6 per click with remaining count and sr announcement without stealing focus, and hides button at the end', async () => {
    const items = Array.from({ length: 15 }, (_, index) => {
      const day = String(1 + index).padStart(2, '0')
      return {
        ...fixture.items[0]!,
        id: `org/model-${index + 1}`,
        name: `Model ${day}`,
        releaseDate: `2026-11-${day}`,
      }
    })
    renderPage(async () => ({ ok: true, value: { ...fixture, items } }))
    const section = within(screen.getByTestId('trend-new-models'))
    expect(await section.findAllByTestId('trend-new-model')).toHaveLength(6)
    expect(section.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Model 15', 'Model 14', 'Model 13', 'Model 12', 'Model 11', 'Model 10',
    ])

    const more1 = section.getByRole('button', { name: /더보기 \(9개 남음\)/ })
    expect(more1.getAttribute('aria-controls')).toBe('trend-new-models-list')
    more1.focus()
    fireEvent.click(more1)

    expect(section.getAllByTestId('trend-new-model')).toHaveLength(12)
    expect(document.activeElement).not.toBe(section.getAllByTestId('trend-new-model')[6])
    expect(section.getByRole('status').textContent).toContain('6개')
    expect(section.getByRole('status').textContent).toContain('12개')

    const more2 = section.getByRole('button', { name: /더보기 \(3개 남음\)/ })
    fireEvent.click(more2)

    expect(section.getAllByTestId('trend-new-model')).toHaveLength(15)
    expect(section.getByRole('status').textContent).toContain('3개')
    expect(section.getByRole('status').textContent).toContain('15개')
    expect(section.queryByRole('button', { name: /더보기/ })).toBeNull()
  })

  it('When 6 or fewer items arrive Then hides the show-more button', async () => {
    renderPage(async () => ({ ok: true, value: fixture }))
    const section = within(screen.getByTestId('trend-new-models'))
    expect(await section.findAllByTestId('trend-new-model')).toHaveLength(3)
    expect(section.queryByRole('button', { name: /더보기/ })).toBeNull()
  })
})
