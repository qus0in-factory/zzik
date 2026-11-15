// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import type { OffpeakSchedule } from '@domain/usage/offpeak'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import { createDisabledHistoryDeps, HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { UsageSection } from '@ui/usage/UsageSection'
import { createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { renderWithUsage } from '../../helpers/query'

afterEach(cleanup)

const FIXED_UTC_ISO = '2026-11-15T12:00:00Z'
const INLINE_OFFPEAK_SCHEDULE: OffpeakSchedule = {
  opencode: { windows: [{ start: '00:00', end: '24:00' }] },
  ollama: { windows: [{ start: '00:00', end: '24:00' }] },
}

describe('Given UsageSection offpeak wiring through UsageDeps.offpeak', () => {
  it('When an inline schedule defines only opencode and ollama Then among all 6 providers only those two render OffpeakBadge', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => FIXED_UTC_ISO },
      scheduler: createFakeUsageScheduler(),
      offpeak: INLINE_OFFPEAK_SCHEDULE,
    }

    renderWithUsage(
      <HistoryDepsProvider deps={createDisabledHistoryDeps()}>
        {USAGE_PROVIDERS.map((provider) => (
          <UsageSection key={provider} provider={provider} />
        ))}
      </HistoryDepsProvider>,
      deps,
    )

    for (const provider of USAGE_PROVIDERS) {
      const section = screen.getByTestId(`usage-section-${provider}`)
      if (provider === 'opencode' || provider === 'ollama') {
        const badge = within(section).getByTestId('offpeak-badge')
        expect(badge.getAttribute('data-active')).toBe('true')
      } else {
        expect(within(section).queryByTestId('offpeak-badge')).toBeNull()
      }
    }
  })

  it('When deps.offpeak is omitted Then no section renders OffpeakBadge', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => FIXED_UTC_ISO },
      scheduler: createFakeUsageScheduler(),
    }

    renderWithUsage(
      <HistoryDepsProvider deps={createDisabledHistoryDeps()}>
        <UsageSection provider="opencode" />
        <UsageSection provider="ollama" />
      </HistoryDepsProvider>,
      deps,
    )

    expect(within(screen.getByTestId('usage-section-opencode')).queryByTestId('offpeak-badge')).toBeNull()
    expect(within(screen.getByTestId('usage-section-ollama')).queryByTestId('offpeak-badge')).toBeNull()
  })
})
