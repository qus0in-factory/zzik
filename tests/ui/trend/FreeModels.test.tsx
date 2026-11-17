// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  it('When both groups have items Then shows OpenCode Go 무료 and Ollama Cloud 무료 groups with badges and links', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '무료 모델' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-free-models'))
    expect(await section.findByText('Hy4 flash Free')).toBeTruthy()
    expect(section.getByRole('heading', { name: 'OpenCode Go 무료' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Ollama Cloud 무료' })).toBeTruthy()
    expect(section.getByText('Beam Free')).toBeTruthy()
    expect(section.getByText("Reflection's Beam is freely available on Ollama for a limited time")).toBeTruthy()
    expect(section.getAllByText('무료')).toHaveLength(3)
    expect(section.getAllByText('기간 한정')).toHaveLength(3)
    expect(section.getAllByText('지역 한정')).toHaveLength(1)
    expect(section.getAllByText('최근 추가')).toHaveLength(1)
    expect(section.getByRole('link', { name: /공지 보기/ }).getAttribute('href')).toBe('https://ollama.com/blog/reflection-beam')
    expect(section.getByText(/출처 OpenCode Go · Ollama 블로그 · 갱신/)).toBeTruthy()
  })

  it('When only one group has items Then hides the empty group heading', async () => {
    const goOnly: TrendSectionPayload = { ...free, items: free.items.filter((i) => i.freeKind === 'opencode-go') }
    renderPage(async (section) => ({ ok: true, value: section === 'free-models' ? goOnly : latest }))
    const section = within(await screen.findByTestId('trend-free-models'))
    expect(await section.findByRole('heading', { name: 'OpenCode Go 무료' })).toBeTruthy()
    expect(section.queryByRole('heading', { name: 'Ollama Cloud 무료' })).toBeNull()
  })

  it('When both groups are empty or not_ready Then hides the entire free-models section without empty-state text', async () => {
    renderPage(async (section) => ({ ok: true, value: section === 'free-models' ? { ...free, items: [] } : latest }))
    await screen.findByTestId('trend-new-models')
    await waitFor(() => expect(screen.queryByTestId('trend-free-models')).toBeNull())
    cleanup()

    renderPage(async (section) => (section === 'free-models'
      ? { ok: false, reason: 'not_ready', message: 'not_ready' }
      : { ok: true, value: latest }))
    await screen.findByTestId('trend-new-models')
    await waitFor(() => expect(screen.queryByTestId('trend-free-models')).toBeNull())
  })

  it('When the section is loading Then shows the loading state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<TrendGateway['fetchSection']>>>()
    renderPage(() => deferred.promise)
    expect(await screen.findByText('무료 모델을 불러오는 중…')).toBeTruthy()
  })

  it('When the section fails Then shows an error with retry', async () => {
    renderPage(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    const section = within(screen.getByTestId('trend-free-models'))
    const alert = await section.findByRole('alert')
    expect(alert.textContent).toContain('무료 모델을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
  })

  it('When /trend renders Then sections follow 성능 지표 → 신규 모델 → 무료 모델 → 참고 링크', async () => {
    renderPage(bySection)
    await screen.findByText('Hy4 flash Free')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['성능 지표', '신규 모델', '무료 모델', '참고 링크'])
  })
})
