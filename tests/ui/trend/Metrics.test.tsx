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
import metricsFixture from '../../fixtures/trend/metrics.payload.json'
import freeFixture from '../../fixtures/trend/free-models.payload.json'
import newFixture from '../../fixtures/trend/new-models.payload.json'

const metrics = metricsFixture as TrendSectionPayload
const free = freeFixture as TrendSectionPayload
const latest = newFixture as TrendSectionPayload

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
  value: section === 'metrics' ? metrics : section === 'free-models' ? free : latest,
})

describe('Given the metrics section on /trend', () => {
  it('When data loads Then shows AA/OR blocks, rank deltas, share, attributions and stale state', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '성능 지표' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('Claude Fable 5')).toBeTruthy()
    expect(section.getByRole('heading', { name: 'Artificial Analysis Intelligence Index' })).toBeTruthy()
    expect(section.getByRole('heading', { name: 'OpenRouter 사용량 상위 변동' })).toBeTruthy()
    expect(section.getByText('지수 72')).toBeTruthy()
    expect(section.getByText('2위 상승')).toBeTruthy()
    expect(section.getByText('1위 하락')).toBeTruthy()
    expect(section.getByText('신규')).toBeTruthy()
    expect(section.getByText('점유율 60.0%')).toBeTruthy()
    expect(section.getByText('갱신 지연')).toBeTruthy()
    expect(section.getByText('7일 스냅샷이 쌓이면 순위·점유율 변동을 표시합니다.')).toBeTruthy()
    expect(section.getByText(/출처: Artificial Analysis — artificialanalysis\.ai \(Intelligence Index v3\.0, 2026-11-17 기준\)/)).toBeTruthy()
    expect(section.getByText(/출처: OpenRouter \(openrouter\.ai\/rankings\), 2026-11-17T04:00:00Z 기준 · CC BY 4\.0/)).toBeTruthy()
    expect(section.getAllByTestId('trend-metrics-entry')).toHaveLength(5)
  })

  it('When a block is not configured Then explains it instead of rendering entries', async () => {
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        blocks: [{ id: 'aa-intelligence', status: 'not_configured', asOf: '2026-11-17', entries: [], attribution: '' }],
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('이 출처는 아직 설정되지 않았습니다.')).toBeTruthy()
    expect(section.queryByTestId('trend-metrics-entry')).toBeNull()
  })

  it('When the section is loading Then shows the loading state', async () => {
    const deferred = createDeferred<Awaited<ReturnType<TrendGateway['fetchSection']>>>()
    renderPage(() => deferred.promise)
    expect(await screen.findByText('성능 지표를 불러오는 중…')).toBeTruthy()
  })

  it('When the section fails Then shows an error with retry; not_ready is an empty state', async () => {
    renderPage(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    const section = within(screen.getByTestId('trend-metrics'))
    const alert = await section.findByRole('alert')
    expect(alert.textContent).toContain('성능 지표를 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPage(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    expect(await screen.findByText('아직 표시할 성능 지표가 없습니다.')).toBeTruthy()
    expect(within(screen.getByTestId('trend-metrics')).queryByRole('alert')).toBeNull()
  })

  it('When the payload has no blocks Then shows the empty state', async () => {
    renderPage(async () => ({ ok: true, value: { ...metrics, blocks: [] } }))
    expect(await screen.findByText('아직 표시할 성능 지표가 없습니다.')).toBeTruthy()
  })

  it('When /trend renders Then metrics stays in the fourth slot before the reference links', async () => {
    renderPage(bySection)
    await screen.findByText('Claude Fable 5')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['요금제 추가', '최근 7일 새 모델', '무료로 쓸 수 있는 모델', '성능 지표', '참고 링크'])
  })
})
