// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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
    expect(await screen.findByText('Claude Fable 5.2')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '최근 7일 새 모델' })).toBeTruthy()
    expect(screen.getByText('Qwen4 Max')).toBeTruthy()
    expect(screen.getByText('HY4 Flash')).toBeTruthy()
    expect(screen.getAllByText('무료')).toHaveLength(1)
    expect(screen.getAllByText('오픈 웨이트')).toHaveLength(2)
    expect(screen.getAllByText('출시 2026-11-16')).toHaveLength(2)
    expect(screen.getAllByText('제공 2곳')).toHaveLength(2)
    expect(screen.getByText(/출처 models\.dev · 갱신/)).toBeTruthy()
    expect(screen.getByText('참고 링크')).toBeTruthy()
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
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('새 모델을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPage(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    expect(await screen.findByText('최근 7일 새 모델이 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('When the section payload has no items Then shows the empty state', async () => {
    renderPage(async () => ({ ok: true, value: { ...fixture, items: [] } }))
    expect(await screen.findByText('최근 7일 새 모델이 없습니다.')).toBeTruthy()
  })
})
