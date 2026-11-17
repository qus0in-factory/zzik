// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { createFixtureTrendGateway } from '@infra/trend/fixture-trend-gateway'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { TrendPage } from '@ui/TrendPage'
import { createTestQueryClient } from '../../helpers/query'

afterEach(cleanup)

function renderFixturePage() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <TrendGatewayProvider deps={{ gateway: createFixtureTrendGateway(), enabled: true }}>
        <MemoryRouter initialEntries={['/trend?fixture=normal']}>
          <TrendPage />
        </MemoryRouter>
      </TrendGatewayProvider>
    </QueryClientProvider>,
  )
}

describe('Given /trend?fixture=normal', () => {
  it('When the DEV fixture gateway provides data Then every section is filled for the screenshot', async () => {
    renderFixturePage()
    expect(await screen.findByRole('heading', { name: '성능 지표' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '신규 모델' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '무료 모델' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '참고 링크' })).toBeTruthy()

    expect(await screen.findAllByTestId('trend-metrics-entry')).toHaveLength(3)
    const metrics = within(screen.getByTestId('trend-metrics'))
    expect(metrics.queryByText('Artificial Analysis Intelligence Index')).toBeNull()
    expect(metrics.getByTestId('trend-metrics-aa-citation').textContent).toContain('요즘 주목받는 모델은 Claude Opus, Gemini Carbon, GPT Sol')
    expect(metrics.getByRole('link', { name: /Artificial Analysis/ }).getAttribute('href')).toBe('https://artificialanalysis.ai/leaderboards/models')

    expect(await screen.findAllByTestId('trend-new-model')).toHaveLength(6)
    const newest = within(screen.getByTestId('trend-new-models'))
    expect(newest.getAllByText('OpenRouter').length).toBeGreaterThan(0)
    expect(newest.getByRole('button', { name: '더보기 (3개 남음)' })).toBeTruthy()

    expect(await screen.findAllByTestId('trend-free-model')).toHaveLength(3)
    expect(within(screen.getByRole('navigation', { name: '트렌드 섹션' })).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/trend?fixture=normal#metrics', '/trend?fixture=normal#new-models', '/trend?fixture=normal#free-models', '/trend?fixture=normal#links'])
    const free = within(screen.getByTestId('trend-free-models'))
    expect(free.getByRole('heading', { name: 'OpenCode Go 무료' })).toBeTruthy()
    expect(free.queryByRole('heading', { name: 'Ollama Cloud' })).toBeNull()
    expect(free.getAllByText('기간 한정')).toHaveLength(2)
    expect(free.getAllByText('지역 한정')).toHaveLength(2)
    expect(free.getAllByText('최근 추가')).toHaveLength(2)
    expect(free.getAllByRole('link', { name: '가격표' })).toHaveLength(3)

    const links = screen.getByRole('list', { name: '트렌드 참고 링크' })
    expect(within(links).getAllByRole('link')).toHaveLength(5)
    expect(within(links).getByRole('link', { name: /Artificial Analysis/ }).getAttribute('href')).toBe('https://artificialanalysis.ai/leaderboards/models')
  })
})
