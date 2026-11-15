// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { OffpeakNotice } from '@app/usage/offpeak-notice'
import { createDisabledHistoryDeps, HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { UsageSection } from '@ui/usage/UsageSection'
import { createFakeUsageGateway, createFakeUsageScheduler, NOW_ISO } from '../../fakes/usage-ports'
import { renderWithUsage } from '../../helpers/query'

afterEach(cleanup)

describe('Given UsageSection offpeak wiring', () => {
  it('When opencode receives an offpeak notice and claude does not Then only the opencode section renders OffpeakBadge', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => NOW_ISO },
      scheduler: createFakeUsageScheduler(),
    }
    const opencodeNotice: OffpeakNotice = {
      active: true,
      text: 'off-peak · 07:30까지',
      description: 'OpenCode off-peak 시간대 · 07:30에 끝남',
    }

    renderWithUsage(
      <HistoryDepsProvider deps={createDisabledHistoryDeps()}>
        <UsageSection provider="opencode" offpeak={opencodeNotice} />
        <UsageSection provider="claude" offpeak={null} />
      </HistoryDepsProvider>,
      deps,
    )

    const opencodeSection = screen.getByTestId('usage-section-opencode')
    const claudeSection = screen.getByTestId('usage-section-claude')

    const badge = within(opencodeSection).getByTestId('offpeak-badge')
    expect(badge.getAttribute('data-active')).toBe('true')
    expect(within(opencodeSection).getByText(opencodeNotice.text)).toBeTruthy()
    expect(within(claudeSection).queryByTestId('offpeak-badge')).toBeNull()
  })

  it('When offpeak prop is omitted Then UsageSection delegates to useOffpeakNotice and renders without error', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => NOW_ISO },
      scheduler: createFakeUsageScheduler(),
    }

    renderWithUsage(
      <HistoryDepsProvider deps={createDisabledHistoryDeps()}>
        <UsageSection provider="ollama" />
      </HistoryDepsProvider>,
      deps,
    )

    const ollamaSection = screen.getByTestId('usage-section-ollama')
    expect(within(ollamaSection).queryByTestId('offpeak-badge')).toBeNull()
  })
})
