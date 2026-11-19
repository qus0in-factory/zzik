// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AaTrendResponse } from '@shared/trend-contract'
import type { KeyValueStorage } from '@domain/usage/history/ports'
import type { AaTrendGateway, AaTrendResult } from '@domain/trend/aa-gateway'
import { AaTrendGatewayProvider } from '@app/trend/AaTrendContext'
import { AaTrendPanel } from '@ui/usage/AaTrendPanel'
import { AA_TREND_EXPANDED_KEY } from '@app/trend/useAaTrendExpanded'
import { createTestQueryClient } from '../../helpers/query'
import { createMemoryKeyValue } from '../../fakes/history-ports'

afterEach(cleanup)

const SAMPLE: AaTrendResponse = {
  day: '2026-11-17',
  indexVersion: '5.0',
  attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
  intelligenceTop: [
    { slug: 'claude-fable-5', name: 'Claude Fable 5', creator: 'Anthropic', intelligenceIndex: 89, priceIn: 3, priceOut: 15, outputTokensPerSecond: 85.4, timeToFirstTokenSeconds: 0.92, costPerTask: 0.8, releaseDate: '2026-11-09' },
  ],
  priceLowest: [
    { slug: 'nano-model', name: 'Nano Model', creator: 'OpenAI', intelligenceIndex: 62, priceIn: 0.1, priceOut: 0.4, outputTokensPerSecond: 140, timeToFirstTokenSeconds: 0.45, costPerTask: 0.2, releaseDate: '2026-11-10' },
  ],
  costLowest: [
    { slug: 'ultra-model', name: 'Ultra Model', creator: 'Anthropic', intelligenceIndex: 88, priceIn: 15, priceOut: 75, outputTokensPerSecond: 40, timeToFirstTokenSeconds: 1.8, costPerTask: 0.5, releaseDate: '2026-11-01' },
  ],
  speedHighest: [
    { slug: 'fast-model', name: 'Fast Model', creator: 'Groq', intelligenceIndex: 70, priceIn: 0.2, priceOut: 0.8, outputTokensPerSecond: 320.5, timeToFirstTokenSeconds: 0.35, costPerTask: 0.3, releaseDate: '2026-11-12' },
  ],
  latencyLowest: [
    { slug: 'instant-model', name: 'Instant Model', creator: 'Google', intelligenceIndex: 74, priceIn: 0.15, priceOut: 0.6, outputTokensPerSecond: 210, timeToFirstTokenSeconds: 0.22, costPerTask: 0.4, releaseDate: '2026-11-11' },
  ],
}

function renderPanel(fetchAaTrend: AaTrendGateway['fetchAaTrend'], storage?: KeyValueStorage) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AaTrendGatewayProvider deps={{ gateway: { fetchAaTrend }, enabled: true, storage }}>
        <MemoryRouter initialEntries={['/usage']}>
          <AaTrendPanel />
        </MemoryRouter>
      </AaTrendGatewayProvider>
    </QueryClientProvider>,
  )
}

describe('Given the AA Trend panel inside /usage', () => {
  it('When initially rendered Then stays collapsed and does not call /api/trend/aa until expanded', async () => {
    const fetchSpy = vi.fn<AaTrendGateway['fetchAaTrend']>(async () => ({ ok: true, value: SAMPLE }))
    renderPanel(fetchSpy)

    const toggle = screen.getByRole('button', { name: /트렌드/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Claude Fable 5')).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    expect(screen.getByText(/기준일 2026-11-17/)).toBeTruthy()
    expect(screen.getByText(/v5\.0/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'artificialanalysis.ai' }).getAttribute('href')).toBe('https://artificialanalysis.ai')
    expect(screen.getByRole('link', { name: /공개 트렌드/ }).getAttribute('href')).toBe('/trend')

    fireEvent.click(screen.getByRole('tab', { name: '가격' }))
    expect(screen.getByText('Nano Model')).toBeTruthy()
    expect(screen.getByText('Ultra Model')).toBeTruthy()
    expect(screen.getAllByText('작업당 비용 최저 20 ($)').length).toBeGreaterThan(0)
    expect(screen.getByText('작업당 비용 ($)')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '속도' }))
    expect(screen.getByText('Fast Model')).toBeTruthy()
    expect(screen.getByText('Instant Model')).toBeTruthy()
  })

  it('When the speed tab is open Then the latency label names TTFT, not end-to-end response time', async () => {
    renderPanel(async () => ({ ok: true, value: SAMPLE }))
    fireEvent.click(screen.getByRole('button', { name: /트렌드/ }))
    await screen.findByText('Claude Fable 5')
    fireEvent.click(screen.getByRole('tab', { name: '속도' }))
    expect(screen.getAllByText('첫 토큰 시간(TTFT) 하위 10 (초)').length).toBeGreaterThan(0)
    expect(screen.queryByText(/응답 시간\(TTFT\)/)).toBeNull()
  })

  it('When /api/trend/aa fails Then shows an error with retry; not_ready shows empty message', async () => {
    const failFetch = vi.fn<() => Promise<AaTrendResult>>(async () => ({ ok: false, reason: 'api_error', message: 'http_500' }))
    renderPanel(failFetch)
    fireEvent.click(screen.getByRole('button', { name: /트렌드/ }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    cleanup()

    renderPanel(async () => ({ ok: false, reason: 'not_ready', message: 'not_ready' }))
    fireEvent.click(screen.getByRole('button', { name: /트렌드/ }))
    expect(await screen.findByText(/아직 수집된 Artificial Analysis/)).toBeTruthy()
  })
})

describe('Given the AA Trend panel with a key-value storage', () => {
  const ok = async () => ({ ok: true as const, value: SAMPLE })

  it('When expanded and remounted Then stays expanded', async () => {
    const storage = createMemoryKeyValue()
    const first = renderPanel(ok, storage)
    fireEvent.click(screen.getByRole('button', { name: /트렌드/ }))
    first.unmount()

    renderPanel(ok, storage)
    expect(screen.getByRole('button', { name: /트렌드/ }).getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('Claude Fable 5')).toBeTruthy()
  })

  it('When expanded, then collapsed, and remounted Then stays collapsed', () => {
    const storage = createMemoryKeyValue()
    const first = renderPanel(ok, storage)
    const toggle = screen.getByRole('button', { name: /트렌드/ })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    first.unmount()

    renderPanel(ok, storage)
    expect(screen.getByRole('button', { name: /트렌드/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('When nothing is stored Then uses the default (collapsed)', () => {
    renderPanel(ok, createMemoryKeyValue())
    expect(screen.getByRole('button', { name: /트렌드/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('When the stored value is garbage Then uses the default (collapsed)', () => {
    renderPanel(ok, createMemoryKeyValue({ [AA_TREND_EXPANDED_KEY]: 'maybe' }))
    expect(screen.getByRole('button', { name: /트렌드/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('When writes fail Then the toggle still works for the session', () => {
    const storage = createMemoryKeyValue()
    storage.failWrites = true
    renderPanel(ok, storage)
    const toggle = screen.getByRole('button', { name: /트렌드/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('When reads throw Then silently falls back to the default', () => {
    const storage: KeyValueStorage = {
      get() {
        throw new Error('blocked')
      },
      set: () => false,
      remove: () => {},
    }
    renderPanel(ok, storage)
    expect(screen.getByRole('button', { name: /트렌드/ }).getAttribute('aria-expanded')).toBe('false')
  })
})
