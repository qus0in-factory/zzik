// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OffpeakNotice } from '@app/usage/offpeak-notice'
import { OffpeakBadge } from '@ui/usage/OffpeakBadge'

afterEach(cleanup)

describe('Given an OffpeakBadge', () => {
  it('When notice is active Then it renders with data-active="true", --usage-ok tone, text, title and sr-only description', () => {
    const notice: OffpeakNotice = {
      active: true,
      text: 'off-peak · 07:30까지',
      description: 'Ollama off-peak 시간대 · 07:30에 끝남',
    }
    render(<OffpeakBadge notice={notice} />)
    const badge = screen.getByTestId('offpeak-badge')
    expect(badge.getAttribute('data-active')).toBe('true')
    expect(badge.getAttribute('title')).toBe(notice.description)
    expect(badge.className).toContain('--usage-ok')
    expect(screen.getByText(notice.text)).toBeTruthy()
    const srOnly = badge.querySelector('.sr-only')
    expect(srOnly?.textContent).toBe(notice.description)
  })

  it('When notice is inactive Then it renders with data-active="false", muted tone, text, title and sr-only description', () => {
    const notice: OffpeakNotice = {
      active: false,
      text: 'off-peak 03:00부터',
      description: 'Ollama off-peak 시간대 아님 · 03:00에 시작',
    }
    render(<OffpeakBadge notice={notice} />)
    const badge = screen.getByTestId('offpeak-badge')
    expect(badge.getAttribute('data-active')).toBe('false')
    expect(badge.getAttribute('title')).toBe(notice.description)
    expect(badge.className).toContain('text-muted-foreground')
    expect(badge.className).not.toContain('--usage-ok')
    expect(screen.getByText(notice.text)).toBeTruthy()
    const srOnly = badge.querySelector('.sr-only')
    expect(srOnly?.textContent).toBe(notice.description)
  })
})
