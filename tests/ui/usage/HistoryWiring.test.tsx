// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import type { HistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { createChartPrefsStore } from '@app/usage/history/chart-prefs-store'
import { createHistoryBudget } from '@app/usage/history/sync-history'
import { UsageSection } from '@ui/usage/UsageSection'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import { createFakeHistoryCache, createFakeHistoryGateway, createFakeHistoryServer, createMemoryKeyValue, syntheticEvents } from '../../fakes/history-ports'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { createTestQueryClient } from '../../helpers/query'

afterEach(cleanup)

function renderSection(enabled: boolean | 'no-provider') {
  const NOW = Date.parse('2026-11-14T12:00:00.000Z')
  const gateway = createFakeHistoryGateway({ claude: createFakeHistoryServer('claude', syntheticEvents(40, new Date(NOW - 10 * 3_600_000).toISOString())) })
  gateway.summary = [{ provider: 'claude', okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' }]
  const deps: HistoryDeps = { enabled: enabled === true, gateway, cache: createFakeHistoryCache(), session: createMemoryKeyValue(), prefs: createChartPrefsStore(createMemoryKeyValue()), budget: createHistoryBudget({ now: () => NOW }), memory: new Map(), inflight: new Map(), nowMs: () => NOW }
  const usage = createFakeUsageGateway()
  usage.pushResult({ ok: true, usage: normalRaw, collection: null, rawText: null })
  const client = createTestQueryClient()
  const inner = (
    <UsageGatewayProvider deps={{ gateway: usage, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() }}>
      <UsageSection provider="claude" />
    </UsageGatewayProvider>
  )
  const wrap = (children: ReactNode) => <QueryClientProvider client={client}>{enabled === 'no-provider' ? children : <HistoryDepsProvider deps={deps}>{children}</HistoryDepsProvider>}</QueryClientProvider>
  render(wrap(inner))
  return { gateway }
}

describe('Given the chart wiring in the section (배선 커밋)', () => {
  it('When the flag is on and the history is eligible Then [차트 보기] is shown and opens the lazy chart panel', async () => {
    renderSection(true)
    const button = await screen.findByRole('button', { name: '차트 보기' })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: '차트 닫기' }).getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByRole('region', { name: 'Claude 사용률 추이' })).toBeTruthy()
  })
  it('When the flag is off or there is no provider Then no chart button is drawn and no history request is made', async () => {
    for (const mode of [false, 'no-provider'] as const) {
      cleanup()
      const { gateway } = renderSection(mode)
      await screen.findByText('37%')
      expect(screen.queryByRole('button', { name: '차트 보기' })).toBeNull()
      expect(gateway.summaryCalls).toBe(0)
      expect(gateway.queries).toHaveLength(0)
    }
  })
})
