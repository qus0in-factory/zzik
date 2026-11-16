// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StatusBar } from '@ui/usage/StatusBar'

afterEach(cleanup)

function chart(overrides: Partial<{ label: '차트 보기' | '차트 닫기'; expanded: boolean; disabled: boolean; hint: string | null; calls: string[] }> = {}) {
  const calls = overrides.calls ?? []
  return {
    calls,
    state: {
      label: overrides.label ?? '차트 보기',
      expanded: overrides.expanded ?? false,
      disabled: overrides.disabled ?? false,
      hint: overrides.hint === undefined ? null : overrides.hint,
      panelId: 'chart-claude',
      onToggle: () => calls.push('toggle'),
      onIntent: () => calls.push('intent'),
    },
  }
}

describe('Given the chart button in the status bar', () => {
  it('Then aria-expanded/controls are wired and toggle/intent callbacks fire', () => {
    const { calls, state } = chart({ expanded: true, label: '차트 닫기' })
    render(<StatusBar lastSuccessText={null} chart={state} />)
    const toggle = screen.getByRole('button', { name: '차트 닫기' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.getAttribute('aria-controls')).toBe('chart-claude')
    fireEvent.click(toggle)
    fireEvent.focus(toggle)
    fireEvent.pointerEnter(toggle)
    expect(calls).toEqual(['toggle', 'intent', 'intent'])
  })

  it('Then a disabled button keeps focus and exposes the reason via aria-describedby', () => {
    const { calls, state } = chart({ disabled: true, hint: '아직 기록된 이력이 없습니다' })
    render(<StatusBar lastSuccessText={null} chart={state} />)
    const toggle = screen.getByRole('button', { name: '차트 보기' })
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(toggle.getAttribute('aria-describedby')).toBe('chart-claude-hint')
    expect(document.getElementById('chart-claude-hint')?.textContent).toBe('아직 기록된 이력이 없습니다')
    fireEvent.click(toggle)
    expect(calls).toEqual([])
  })

  it('Then no chart prop means no button', () => {
    render(<StatusBar lastSuccessText={null} />)
    expect(screen.queryByRole('button', { name: /차트/ })).toBeNull()
  })

  it('Then both open and close states render an aria-hidden icon on the left without changing the accessible name', () => {
    const open = chart({ label: '차트 보기', expanded: false })
    const { rerender } = render(<StatusBar lastSuccessText={null} chart={open.state} />)
    const openBtn = screen.getByRole('button', { name: '차트 보기' })
    const openIcon = openBtn.querySelector('svg')
    expect(openIcon).not.toBeNull()
    expect(openIcon?.getAttribute('aria-hidden')).toBe('true')
    expect(openIcon?.getAttribute('class')).toContain('size-4')
    expect(openBtn.firstElementChild).toBe(openIcon)

    const close = chart({ label: '차트 닫기', expanded: true })
    rerender(<StatusBar lastSuccessText={null} chart={close.state} />)
    const closeBtn = screen.getByRole('button', { name: '차트 닫기' })
    const closeIcon = closeBtn.querySelector('svg')
    expect(closeIcon).not.toBeNull()
    expect(closeIcon?.getAttribute('aria-hidden')).toBe('true')
    expect(closeBtn.firstElementChild).toBe(closeIcon)
  })
})
