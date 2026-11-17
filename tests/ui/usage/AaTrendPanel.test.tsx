// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { AaTrendResponse } from '@shared/trend-contract'
import type { AaTrendGateway, AaTrendResult } from '@domain/trend/aa-gateway'
import { AaTrendGatewayProvider } from '@app/trend/AaTrendContext'
import { AaTrendPanel } from '@ui/usage/AaTrendPanel'
import { createTestQueryClient } from '../../helpers/query'

afterEach(cleanup)

const SAMPLE: AaTrendResponse = {
  day: '2026-11-17',
  indexVersion: '5.0',
  attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
  intelligenceTop: [
    { slug: 'claude-fable-5', name: 'Claude Fable 5', creator: 'Anthropic', intelligenceIndex: 89, priceIn: 3, priceOut: 15, outputTokensPerSecond: 85.4, timeToFirstTokenSeconds: 0.92, releaseDate: '2026-11-09' },
  ],
  priceLowest: [
    { slug: 'nano-model', name: 'Nano Model', creator: 'OpenAI', intelligenceIndex: 62, priceIn: 0.1, priceOut: 0.4, outputTokensPerSecond: 140, timeToFirstTokenSeconds: 0.45, releaseDate: '2026-11-10' },
  ],
  priceHighest: [
    { slug: 'ultra-model', name: 'Ultra Model', creator: 'Anthropic', intelligenceIndex: 88, priceIn: 15, priceOut: 75, outputTokensPerSecond: 40, timeToFirstTokenSeconds: 1.8, releaseDate: '2026-11-01' },
  ],
  speedHighest: [
    { slug: 'fast-model', name: 'Fast Model', creator: 'Groq', intelligenceIndex: 70, priceIn: 0.2, priceOut: 0.8, outputTokensPerSecond: 320.5, timeToFirstTokenSeconds: 0.35, releaseDate: '2026-11-12' },
  ],
  latencyLowest: [
    { slug: 'instant-model', name: 'Instant Model', creator: 'Google', intelligenceIndex: 74, priceIn: 0.15, priceOut: 0.6, outputTokensPerSecond: 210, timeToFirstTokenSeconds: 0.22, releaseDate: '2026-11-11' },
  ],
}

function renderPanel(fetchAaTrend: AaTrendGateway['fetchAaTrend']) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AaTrendGatewayProvider deps={{ gateway: { fetchAaTrend }, enabled: true }}>
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

    fireEvent.click(screen.getByRole('tab', { name: '속도' }))
    expect(screen.getByText('Fast Model')).toBeTruthy()
    expect(screen.getByText('Instant Model')).toBeTruthy()
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
