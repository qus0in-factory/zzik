// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { TrendGateway } from '@domain/trend/gateway'
import type { TrendSection, TrendSectionPayload } from '@shared/trend-contract'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { TrendPage } from '@ui/TrendPage'
import { createDeferred } from '../../fakes/usage-ports'
import { createTestQueryClient } from '../../helpers/query'
import freePayload from '../../fixtures/trend/free-models.payload.json'
import newPayload from '../../fixtures/trend/new-models.payload.json'

const free = freePayload as TrendSectionPayload
const latest = newPayload as TrendSectionPayload

afterEach(cleanup)

function renderPage(fetchSection: TrendGateway['fetchSection']) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TrendGatewayProvider deps={{ gateway: { fetchSection }, enabled: true }}>
        <MemoryRouter initialEntries={['/trend']}>
          <TrendPage />
        </MemoryRouter>
      </TrendGatewayProvider>
    </QueryClientProvider>,
  )
}

const bySection: TrendGateway['fetchSection'] = async (section: TrendSection) => ({
  ok: true,
  value: section === 'free-models' ? free : latest,
})

describe('Given the free-models section on /trend', () => {
  it('When data loads Then shows OpenCode Go and Ollama Cloud groups, badges and source state', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '무료 모델' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-free-models'))
    expect(await section.findByText('DeepSeek V4.1 Flash 1017')).toBeTruthy()
    expect(section.getByRole('heading', { name: 'OpenCode Go' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Ollama Cloud' })).toBeTruthy()
    expect(section.getAllByText('GLM 5.3')).toHaveLength(2)
    expect(section.getByText('Qwen4 Max')).toBeTruthy()
    expect(section.getAllByText('요금제 포함')).toHaveLength(4)
    expect(section.getByText(/출처 OpenCode Go · Ollama Cloud · 갱신/)).toBeTruthy()
  })

  it('When the section is loading Then shows the loading state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<TrendGateway['fetchSection']>>>()
    renderPage(() => deferred.promise)
    expect(await screen.findByText('무료 모델을 불러오는 중…')).toBeTruthy()
  })

  it('When the section fails Then shows an error with retry; not_ready is an empty state', async () => {
    renderPage(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    const section = within(screen.getByTestId('trend-free-models'))
    const alert = await section.findByRole('alert')
    expect(alert.textContent).toContain('무료 모델을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPage(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    expect(await screen.findByText('요금제에 포함된 모델이 없습니다.')).toBeTruthy()
    expect(within(screen.getByTestId('trend-free-models')).queryByRole('alert')).toBeNull()
  })

  it('When the payload has no items Then shows the empty state without group headings', async () => {
    renderPage(async () => ({ ok: true, value: { ...free, items: [] } }))
    expect(await screen.findByText('요금제에 포함된 모델이 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'OpenCode Go' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Ollama Cloud' })).toBeNull()
  })

  it('When /trend renders Then sections follow 성능 지표 → 신규 모델 → 무료 모델 → 참고 링크', async () => {
    renderPage(bySection)
    await screen.findByText('DeepSeek V4.1 Flash 1017')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['성능 지표', '신규 모델', '무료 모델', '참고 링크'])
  })
})
