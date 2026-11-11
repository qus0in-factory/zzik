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
    render(<RawJson raw={report.raw} />)
    const toggle = screen.getByRole('button', { name: '원본 JSON' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('When expanded then the pretty printed original object is shown and collapsible again (U7)', () => {
    const report = buildUsageView(normalRaw, { now: NOW })
    render(<RawJson raw={report.raw} />)
    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    const region = screen.getByRole('region')
    expect((screen.getByRole('button', { name: '원본 JSON' })).getAttribute('aria-expanded')).toBe('true')
    expect(region.textContent).toBe(JSON.stringify(report.raw, null, 2))

    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('When the response has unknown keys then the raw text still contains them as-is (U7)', () => {
    const report = buildUsageView(unknownKeysRaw, { now: NOW })
    render(<RawJson raw={report.raw} />)
    fireEvent.click(screen.getByRole('button', { name: '원본 JSON' }))
    expect(screen.getByRole('region').textContent).toContain('thirty_day')
    expect(screen.getByRole('button', { name: '복사' })).toBeTruthy()
  })
})
