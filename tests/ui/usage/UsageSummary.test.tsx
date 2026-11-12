// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { UsageSummary } from '@ui/usage/UsageSummary'
import { usageProviderIds } from '@app/usage/provider-meta'
import type { UsageGatewayResult } from '@domain/usage/gateway'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import limitedRaw from '../../fixtures/codex-usage.limited.json'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { makeUsageProviders } from '../../helpers/query'

afterEach(cleanup)

function renderSummary(claude: UsageGatewayResult, codex: UsageGatewayResult): void {
  const gateway = createFakeUsageGateway()
  gateway.pushResultFor('claude', claude)
  gateway.pushResultFor('codex', codex)
  const providers = makeUsageProviders({
    gateway,
    clock: createFakeUsageClock(),
    scheduler: createFakeUsageScheduler(),
  })
  render(
    <providers.wrapper>
      <UsageSummary />
    </providers.wrapper>,
  )
}

const OK_CLAUDE = { ok: true, usage: normalRaw, collection: null, rawText: null } as const
const OK_CODEX_LIMITED = { ok: true, usage: limitedRaw, collection: null, rawText: null } as const

describe('Given the provider summary chips (ADR 0.3 D8)', () => {
  it('When both providers are ready then each chip shows the provider title and its own status', async () => {
    renderSummary(OK_CLAUDE, OK_CODEX_LIMITED)
    await waitFor(() => expect(screen.getByTestId('usage-summary-claude').textContent).toContain('정상'))
    const claudeChip = screen.getByTestId('usage-summary-claude')
    const codexChip = screen.getByTestId('usage-summary-codex')
    expect(claudeChip.textContent).toContain('Claude')
    expect(codexChip.textContent).toContain('ChatGPT (Codex)')
    expect(codexChip.textContent).toContain('한도 도달')
  })

  it('When a provider is still loading then its chip says so while the other is already ready', async () => {
    const gateway = createFakeUsageGateway()
    gateway.pushResultFor('claude', OK_CLAUDE)
    gateway.pushResultFor('codex', { ok: false, reason: 'network_error', message: null })
    const providers = makeUsageProviders({ gateway, clock: createFakeUsageClock(), scheduler: createFakeUsageScheduler() })
    render(
      <providers.wrapper>
        <UsageSummary />
      </providers.wrapper>,
    )
    await waitFor(() => expect(screen.getByTestId('usage-summary-codex').textContent).toContain('오류'))
    expect(screen.getByTestId('usage-summary-claude').textContent).toContain('정상')
  })

  it('When rendering the chips then they are navigable anchors inside a labeled nav', () => {
    renderSummary(OK_CLAUDE, OK_CODEX_LIMITED)
    expect(screen.getByRole('navigation', { name: '제공자 요약' })).toBeTruthy()
    expect(screen.getByTestId('usage-summary-claude').getAttribute('href')).toBe('#usage-claude')
    expect(screen.getByTestId('usage-summary-codex').getAttribute('href')).toBe('#usage-codex')
  })

  it('When the viewport is narrow then the chip row can wrap (320px 계약)', () => {
    renderSummary(OK_CLAUDE, OK_CODEX_LIMITED)
    const list = screen.getByRole('navigation', { name: '제공자 요약' }).querySelector('ul')
    expect(list?.className).toContain('flex-wrap')
    for (const chip of screen.getAllByTestId(/^usage-summary-/)) {
      expect(chip.className).toContain('max-w-full')
    }
  })
})

describe('Given the provider list source (D8: 목록 기반 렌더)', () => {
  it('When rendering then chips are generated from the registry list, not hardcoded indices', () => {
    renderSummary(OK_CLAUDE, OK_CODEX_LIMITED)
    const ids = usageProviderIds()
    const rendered = screen.getAllByTestId(/^usage-summary-/).map((chip) => chip.getAttribute('data-testid'))
    expect(rendered).toEqual(ids.map((id) => `usage-summary-${id}`))
    expect(ids).toEqual(['claude','codex','antigravity','opencode','grok','ollama'])
    expect(screen.getByTestId('usage-summary-antigravity').getAttribute('href')).toBe('#usage-antigravity')
  })
})
