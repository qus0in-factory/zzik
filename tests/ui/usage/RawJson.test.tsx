// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RawJson } from '@ui/usage/RawJson'
import { buildUsageView } from '@domain/usage/view'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import unknownKeysRaw from '../../fixtures/claude-usage.unknown-keys.json'
import { NOW } from '../../fakes/usage-ports'

afterEach(cleanup)

describe('Given the raw JSON viewer', () => {
  it('When collapsed by default then no pre element exists yet (U7)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<RawJson raw={report.raw} provider="claude" />)
    const toggle = screen.getByRole('button', { name: '원본 JSON' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('When expanded then the pretty printed original object is shown and collapsible again (U7)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<RawJson raw={report.raw} provider="claude" />)
    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    const region = screen.getByRole('region')
    expect((screen.getByRole('button', { name: '원본 JSON' })).getAttribute('aria-expanded')).toBe('true')
    expect(region.textContent).toBe(JSON.stringify(report.raw, null, 2))

    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('When the response has unknown keys then the raw text still contains them as-is (U7)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<RawJson raw={report.raw} provider="claude" />)
    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    expect(screen.getByRole('region').textContent).toContain('thirty_day')
    expect(screen.getByRole('button', { name: '복사' })).toBeTruthy()
  })
})

describe('Given a redacted raw payload (ADR 0.3 v2 H3)', () => {
  it('When rawRedacted has entries then the viewer says how many values were hidden', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<RawJson raw={report.raw} provider="claude" rawRedacted={['tokens.access_token', 'account.email']} />)
    const notice = screen.getByTestId('usage-raw-redacted-claude')
    expect(notice.textContent).toContain('2개')
    expect(notice.textContent).toContain('가렸습니다')
    expect(notice.className).toContain('break-words')
  })

  it.each([[], null, undefined] as const)('When rawRedacted is %j then no notice is rendered', (rawRedacted) => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<RawJson raw={report.raw} provider="claude" rawRedacted={rawRedacted as string[] | null | undefined} />)
    expect(screen.queryByTestId('usage-raw-redacted-claude')).toBeNull()
  })
})
