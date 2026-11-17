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

    expect(await screen.findAllByTestId('trend-new-model')).toHaveLength(3)
    const newest = within(screen.getByTestId('trend-new-models'))
    expect(newest.getAllByText('OpenRouter').length).toBeGreaterThan(0)

    expect(await screen.findAllByTestId('trend-free-model')).toHaveLength(4)
    const free = within(screen.getByTestId('trend-free-models'))
    expect(free.getByRole('heading', { name: 'OpenCode Go' })).toBeTruthy()
    expect(free.getByRole('heading', { name: 'Ollama Cloud' })).toBeTruthy()

    const links = screen.getByRole('list', { name: '트렌드 참고 링크' })
    expect(within(links).getAllByRole('link')).toHaveLength(5)
    expect(within(links).getByRole('link', { name: /Artificial Analysis/ }).getAttribute('href')).toBe('https://artificialanalysis.ai/leaderboards/models')
  })
})
