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
    expect(section.getByText('OpenRouter 일별 순위를 최근·직전 7일로 집계·가공한 요약입니다.')).toBeTruthy()
    const license = section.getByRole('link', { name: 'CC BY 4.0' })
    expect(license.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/')
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

  it('When AA is hidden for terms review Then shows the notice without scores', async () => {
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        blocks: [
          { id: 'aa-intelligence', status: 'under_review', asOf: '2026-11-17', version: '3.0', note: 'terms_review', entries: [], attribution: '' },
          metrics.blocks!.find((block) => block.id === 'or-usage')!,
        ],
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('출처 약관 확인 중입니다. 확인 전에는 점수를 공개하지 않습니다.')).toBeTruthy()
    expect(section.queryByText('지수 72')).toBeNull()
    expect(section.getAllByTestId('trend-metrics-entry')).toHaveLength(2)
  })

  it('When OpenRouter meta.as_of is missing Then labels the time as fetched time', async () => {
    const or = metrics.blocks!.find((block) => block.id === 'or-usage')!
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        blocks: [{
          ...or,
          asOf: '2026-11-17T06:00:00.000Z',
          asOfKind: 'fetched',
          meta: undefined,
        }],
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('출처 기준 시각(meta.as_of)이 없어 조회 시각으로 표시합니다.')).toBeTruthy()
    expect(section.getAllByText(/조회 시각/).length).toBeGreaterThanOrEqual(2)
    expect(section.getByText(/출처: OpenRouter \(openrouter\.ai\/rankings\), 조회 시각/)).toBeTruthy()
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
