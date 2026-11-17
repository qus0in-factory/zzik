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
  it('When data loads Then shows hosted and local groups, badges, providers and source state', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '무료로 쓸 수 있는 모델' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-free-models'))
    expect(await section.findByText('Hy4 Flash Free')).toBeTruthy()
    expect(section.getByRole('heading', { name: '호스팅 무료' })).toBeTruthy()
    expect(section.getByRole('heading', { name: '로컬 실행 가능' })).toBeTruthy()
    expect(section.getByText('Hy4 Flash Free')).toBeTruthy()
    expect(section.getByText('MiMo V2.6 Flash Free')).toBeTruthy()
    expect(section.getByText('Qwen4 Max')).toBeTruthy()
    expect(section.getAllByText('무료')).toHaveLength(2)
    expect(section.getAllByText('로컬 실행')).toHaveLength(1)
    expect(section.getAllByText('오픈 웨이트')).toHaveLength(2)
    expect(section.getAllByText('제공 2곳')).toHaveLength(2)
    expect(section.getByText('제공 1곳')).toBeTruthy()
    expect(section.getByText(/출처 models\.dev · OpenCode Zen · OpenRouter · 갱신/)).toBeTruthy()
    expect(section.getByText('일부 출처가 지연되어 마지막 값을 표시합니다.')).toBeTruthy()
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
    expect(await screen.findByText('최근 30일 안에 해당하는 무료 모델이 없습니다.')).toBeTruthy()
    expect(within(screen.getByTestId('trend-free-models')).queryByRole('alert')).toBeNull()
  })

  it('When the payload has no items Then shows the empty state without group headings', async () => {
    renderPage(async () => ({ ok: true, value: { ...free, items: [] } }))
    expect(await screen.findByText('최근 30일 안에 해당하는 무료 모델이 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '호스팅 무료' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '로컬 실행 가능' })).toBeNull()
  })

  it('When /trend renders Then sections follow 요금제 추가 → 최신 → free → 성능 → 참고 링크', async () => {
    renderPage(bySection)
    await screen.findByText('Hy4 Flash Free')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['요금제 추가', '최근 7일 새 모델', '무료로 쓸 수 있는 모델', '성능 지표', '참고 링크'])
  })
})
