// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { OFFPEAK_SCHEDULE } from '@domain/usage/offpeak-schedule'
import { createDisabledHistoryDeps, HistoryDepsProvider } from '@app/usage/history/HistoryDepsContext'
import { UsageSection } from '@ui/usage/UsageSection'
import { createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { renderWithUsage } from '../../helpers/query'

afterEach(cleanup)

// 일요일 12:00 UTC: OpenCode·Ollama 모두 off-peak 활성 구간
const SUNDAY_UTC_ISO = '2026-11-15T12:00:00Z'

describe('Given UsageSection offpeak wiring through UsageDeps.offpeak', () => {
  it('When OFFPEAK_SCHEDULE is injected via deps Then only opencode and ollama sections render OffpeakBadge and claude/codex do not', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => SUNDAY_UTC_ISO },
      scheduler: createFakeUsageScheduler(),
      offpeak: OFFPEAK_SCHEDULE,
    }

    renderWithUsage(
      <HistoryDepsProvider deps={createDisabledHistoryDeps()}>
        <UsageSection provider="claude" />
        <UsageSection provider="codex" />
        <UsageSection provider="opencode" />
        <UsageSection provider="ollama" />
      </HistoryDepsProvider>,
      deps,
    )

    expect(within(screen.getByTestId('usage-section-claude')).queryByTestId('offpeak-badge')).toBeNull()
    expect(within(screen.getByTestId('usage-section-codex')).queryByTestId('offpeak-badge')).toBeNull()

    const opencodeBadge = within(screen.getByTestId('usage-section-opencode')).getByTestId('offpeak-badge')
    expect(opencodeBadge.getAttribute('data-active')).toBe('true')

    const ollamaBadge = within(screen.getByTestId('usage-section-ollama')).getByTestId('offpeak-badge')
    expect(ollamaBadge.getAttribute('data-active')).toBe('true')
  })

  it('When deps.offpeak is omitted Then no section renders OffpeakBadge', () => {
    const deps = {
      gateway: createFakeUsageGateway(),
      clock: { nowIso: () => SUNDAY_UTC_ISO },
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
