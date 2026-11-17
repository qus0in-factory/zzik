// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { TrendGateway } from '@domain/trend/gateway'
import type { TrendSection, TrendSectionPayload } from '@shared/trend-contract'
import { TrendGatewayProvider } from '@app/trend/TrendGatewayContext'
import { TrendPage } from '@ui/TrendPage'
import { METRICS_VIEW_STORAGE_KEY } from '@ui/trend/MetricsSection'
import { createDeferred } from '../../fakes/usage-ports'
import { createTestQueryClient } from '../../helpers/query'
import metricsFixture from '../../fixtures/trend/metrics.payload.json'
import freeFixture from '../../fixtures/trend/free-models.payload.json'
import newFixture from '../../fixtures/trend/new-models.payload.json'

const metrics = metricsFixture as TrendSectionPayload
const free = freeFixture as TrendSectionPayload
const latest = newFixture as TrendSectionPayload

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

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
  it('When data loads Then shows only the OpenRouter block with share, attribution, license and stale state', async () => {
    renderPage(bySection)
    expect(await screen.findByRole('heading', { name: '성능 지표' })).toBeTruthy()
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('deepseek/deepseek-v4')).toBeTruthy()
    expect(section.getByRole('heading', { name: 'OpenRouter 사용량 상위 변동' })).toBeTruthy()
    expect(section.queryByText('Artificial Analysis Intelligence Index')).toBeNull()
    expect(section.getByTestId('trend-treemap-sr-list').textContent).toContain('점유율 60.0%')
    expect(section.getByText('갱신 지연')).toBeTruthy()
    expect(section.getByText('7일 스냅샷이 쌓이면 순위·점유율 변동을 표시합니다.')).toBeTruthy()
    expect(section.getByText(/출처: OpenRouter \(openrouter\.ai\/rankings\), 2026\. 11\. 17\. 오후 1:00 기준 · CC BY 4\.0/)).toBeTruthy()
    expect(section.getByText('OpenRouter 일별 순위를 최근·직전 7일로 집계·가공한 요약입니다.')).toBeTruthy()
    const license = section.getByRole('link', { name: 'CC BY 4.0' })
    expect(license.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/')
    expect(await section.findByTestId('trend-metrics-treemap')).toBeTruthy()
    expect(section.getAllByTestId('trend-treemap-cell')).toHaveLength(2)
    expect(section.getByText('▲ 2.0pt')).toBeTruthy()
    expect(section.getByText('▼ 1.0pt')).toBeTruthy()
    expect(section.getByTestId('trend-metrics-view-treemap').getAttribute('aria-pressed')).toBe('true')
    expect(section.getByTestId('trend-metrics-view-table').getAttribute('aria-pressed')).toBe('false')
  })

  it('When the table toggle is clicked Then switches to the table, persists, and switches back', async () => {
    renderPage(bySection)
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByTestId('trend-metrics-treemap')).toBeTruthy()
    fireEvent.click(section.getByTestId('trend-metrics-view-table'))
    expect(section.getByTestId('trend-metrics-table')).toBeTruthy()
    expect(section.getAllByTestId('trend-metrics-entry')).toHaveLength(2)
    expect(section.getByTestId('trend-metrics-view-table').getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(METRICS_VIEW_STORAGE_KEY)).toContain('"table"')
    fireEvent.click(section.getByTestId('trend-metrics-view-treemap'))
    expect(section.getByTestId('trend-metrics-treemap')).toBeTruthy()
    expect(section.queryByTestId('trend-metrics-table')).toBeNull()
    expect(window.localStorage.getItem(METRICS_VIEW_STORAGE_KEY)).toContain('"treemap"')
  })

  it('When table view was saved Then opens in table view', async () => {
    window.localStorage.setItem(METRICS_VIEW_STORAGE_KEY, JSON.stringify({ version: 1, mode: 'table' }))
    renderPage(bySection)
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByTestId('trend-metrics-table')).toBeTruthy()
    expect(section.getByTestId('trend-metrics-view-table').getAttribute('aria-pressed')).toBe('true')
    expect(section.queryByTestId('trend-metrics-treemap')).toBeNull()
  })

  it('When a cell is too small Then drops the visible label but keeps an accessible name and the sr-only list', async () => {
    const block = metrics.blocks![0]!
    const payload = {
      ...metrics,
      blocks: [{
        ...block,
        entries: [...block.entries, { id: 'tiny', name: 'Tiny Model', creator: 'tiny', rank: 3, rankDelta: null, kind: 'steady' as const, share7d: 0.001 }],
      }],
    }
    renderPage(async () => ({ ok: true, value: payload }))
    await screen.findByTestId('trend-metrics-treemap')
    const cells = await screen.findAllByTestId('trend-treemap-cell')
    expect(cells).toHaveLength(3)
    const tiny = cells.find((cell) => cell.getAttribute('data-entry-id') === 'tiny')!
    expect(tiny.getAttribute('data-stage')).toBe('none')
    expect(tiny.getAttribute('aria-label')).toContain('Tiny Model')
    expect(tiny.getAttribute('aria-label')).toContain('점유율 0.1%')
    expect(screen.getByTestId('trend-treemap-sr-list').textContent).toContain('Tiny Model')
    expect(screen.getByTestId('trend-treemap-sr-list').querySelectorAll('li')).toHaveLength(3)
  })

  it('When a small cell is focused Then shows the full id and values in a tooltip', async () => {
    const block = metrics.blocks![0]!
    const payload = {
      ...metrics,
      blocks: [{
        ...block,
        entries: [...block.entries, { id: 'tiny/tiny-20261017', name: 'tiny/tiny-20261017', creator: 'tiny', rank: 3, rankDelta: null, kind: 'steady' as const, share7d: 0.001, shareDelta: 0.002 }],
      }],
    }
    renderPage(async () => ({ ok: true, value: payload }))
    await screen.findByTestId('trend-metrics-treemap')
    const cells = await screen.findAllByTestId('trend-treemap-cell')
    const tiny = cells.find((cell) => cell.getAttribute('data-entry-id') === 'tiny/tiny-20261017')!
    fireEvent.focus(tiny)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip.querySelector('p')?.textContent).toBe('tiny/tiny')
    expect(tooltip.textContent).toContain('전체 ID tiny/tiny-20261017')
    expect(tooltip.textContent).toContain('점유율 0.1%')
    expect(tooltip.textContent).toContain('▲ 0.2pt')
    expect(tooltip.textContent).toContain('순위 3')
  })

  it('When a small cell is tapped Then pins its tooltip until Escape', async () => {
    renderPage(bySection)
    await screen.findByTestId('trend-metrics-treemap')
    const cells = await screen.findAllByTestId('trend-treemap-cell')
    const smallest = cells[cells.length - 1]!
    fireEvent.click(smallest)
    expect(await screen.findByRole('tooltip')).toBeTruthy()
    fireEvent.keyDown(screen.getByTestId('trend-treemap-chart'), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('When an entry is other Then paints it with the muted token and keeps the label accessible', async () => {
    const block = metrics.blocks![0]!
    const payload = {
      ...metrics,
      blocks: [{
        ...block,
        entries: [...block.entries, { id: 'other', name: 'other', creator: null, rank: 3, rankDelta: null, kind: 'steady' as const, share7d: 0.05 }],
      }],
    }
    renderPage(async () => ({ ok: true, value: payload }))
    await screen.findByTestId('trend-metrics-treemap')
    const other = screen.getAllByTestId('trend-treemap-cell').find((cell) => cell.getAttribute('data-entry-id') === 'other')!
    expect(other.getAttribute('data-step')).toBe('other')
    expect(other.children[1]?.getAttribute('fill')).toBe('var(--muted)')
    expect(other.getAttribute('aria-label')).toContain('기타')
  })

  it('When the treemap renders Then each cell is focusable and a screen-reader list mirrors it', async () => {
    renderPage(bySection)
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByTestId('trend-metrics-treemap')).toBeTruthy()
    expect(section.getByRole('group', { name: '성능 지표 보기 방식' })).toBeTruthy()
    const cells = section.getAllByTestId('trend-treemap-cell')
    expect(cells.every((cell) => cell.getAttribute('tabindex') === '0')).toBe(true)
    expect(cells.every((cell) => (cell.getAttribute('aria-label') ?? '') !== '')).toBe(true)
    expect(section.getByTestId('trend-treemap-sr-list').getAttribute('aria-label')).toBe('성능 지표 목록')
  })

  it('When an AA citation sentence is present Then shows one line and the source link without a table', async () => {
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        aaCitation: '요즘 주목받는 모델은 Claude Fable, GPT Sol 등입니다.',
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByTestId('trend-metrics-aa-citation')).toBeTruthy()
    expect(section.getByText('요즘 주목받는 모델은 Claude Fable, GPT Sol 등입니다.')).toBeTruthy()
    const source = section.getByRole('link', { name: 'Source: Artificial Analysis (artificialanalysis.ai)' })
    expect(source.getAttribute('href')).toBe('https://artificialanalysis.ai/leaderboards/models')
    expect(section.queryByRole('table')).toBeNull()
    expect(section.getAllByTestId('trend-treemap-cell')).toHaveLength(2)
  })

  it('When no AA citation is present Then hides the AA line and source link', async () => {
    renderPage(bySection)
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('deepseek/deepseek-v4')).toBeTruthy()
    expect(section.queryByTestId('trend-metrics-aa-citation')).toBeNull()
    expect(section.queryByRole('link', { name: 'Source: Artificial Analysis (artificialanalysis.ai)' })).toBeNull()
  })

  it('When a legacy payload still has an AA block Then the UI does not render AA', async () => {
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        blocks: [
          {
            id: 'aa-intelligence', status: 'ok', asOf: '2026-11-17', version: '3.0',
            entries: [{ id: 'a/x', name: 'A X', creator: 'A', rank: 1, rankDelta: null, kind: 'steady', index: 90 }],
            attribution: 'AA',
          },
          ...metrics.blocks!,
        ],
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('deepseek/deepseek-v4')).toBeTruthy()
    expect(section.queryByText('Artificial Analysis Intelligence Index')).toBeNull()
    expect(section.queryByText('지수 90')).toBeNull()
    expect(section.getAllByTestId('trend-treemap-cell')).toHaveLength(2)
  })

  it('When the OR block is not configured Then explains it instead of rendering entries', async () => {
    const or = metrics.blocks!.find((block) => block.id === 'or-usage')!
    renderPage(async () => ({
      ok: true,
      value: {
        ...metrics,
        blocks: [{ ...or, status: 'not_configured', entries: [], attribution: '' }],
      },
    }))
    const section = within(screen.getByTestId('trend-metrics'))
    expect(await section.findByText('이 출처는 아직 설정되지 않았습니다.')).toBeTruthy()
    expect(section.queryByTestId('trend-metrics-treemap')).toBeNull()
    expect(section.queryByTestId('trend-metrics-table')).toBeNull()
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

  it('When /trend renders Then metrics stays first before the other sections', async () => {
    renderPage(bySection)
    await screen.findByText('deepseek/deepseek-v4')
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['성능 지표', '신규 모델', '무료 모델', '참고 링크'])
  })
})
