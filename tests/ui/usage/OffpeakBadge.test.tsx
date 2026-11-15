// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OffpeakNotice } from '@app/usage/offpeak-notice'
import { OffpeakBadge } from '@ui/usage/OffpeakBadge'

afterEach(cleanup)

function oklchToSrgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  const l1 = lum(fg)
  const l2 = lum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function parseOklchToken(block: string, token: string): [number, number, number] {
  const match = block.match(new RegExp(`${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`))
  if (!match) throw new Error(`Missing ${token} oklch definition`)
  return oklchToSrgb(Number(match[1]), Number(match[2]), Number(match[3]))
}

describe('Given an OffpeakBadge', () => {
  it('When notice is active Then it renders with data-active="true", --usage-ok-text token, aria-hidden visible text, title and sr-only description', () => {
    const notice: OffpeakNotice = {
      active: true,
      text: 'off-peak · 07:30까지',
      description: 'Ollama off-peak 시간대 · 07:30에 끝남 · DeepSeek 단가 50 퍼센트 할인',
    }
    render(<OffpeakBadge notice={notice} />)
    const badge = screen.getByTestId('offpeak-badge')
    expect(badge.getAttribute('data-active')).toBe('true')
    expect(badge.getAttribute('title')).toBe(notice.description)
    expect(badge.className).toContain('text-[var(--usage-ok-text)]')

    const visible = screen.getByText(notice.text)
    expect(visible.closest('[aria-hidden="true"]')).not.toBeNull()

    const srOnly = badge.querySelector('.sr-only')
    expect(srOnly?.textContent).toBe(notice.description)
  })

  it('When notice is inactive Then it renders with data-active="false", muted token, aria-hidden visible text, title and sr-only description', () => {
    const notice: OffpeakNotice = {
      active: false,
      text: 'off-peak 03:00부터',
      description: 'Ollama off-peak 시간대 아님 · 03:00에 시작 · DeepSeek 단가 50 퍼센트 할인',
    }
    render(<OffpeakBadge notice={notice} />)
    const badge = screen.getByTestId('offpeak-badge')
    expect(badge.getAttribute('data-active')).toBe('false')
    expect(badge.getAttribute('title')).toBe(notice.description)
    expect(badge.className).toContain('text-muted-foreground')
    expect(badge.className).not.toContain('text-[var(--usage-ok-text)]')

    const visible = screen.getByText(notice.text)
    expect(visible.closest('[aria-hidden="true"]')).not.toBeNull()

    const srOnly = badge.querySelector('.sr-only')
    expect(srOnly?.textContent).toBe(notice.description)
  })

  it('When checking --usage-ok-text tokens in index.css Then light and dark contrast meet WCAG AA (>= 4.5:1)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/index.css'), 'utf8')
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

    const lightBg = parseOklchToken(rootBlock, '--background')
    const lightOkText = parseOklchToken(rootBlock, '--usage-ok-text')
    expect(contrastRatio(lightOkText, lightBg)).toBeGreaterThanOrEqual(4.5)

    const darkOkText = parseOklchToken(darkBlock, '--usage-ok-text')
    const darkBg = oklchToSrgb(0.145, 0, 0)
    expect(contrastRatio(darkOkText, darkBg)).toBeGreaterThanOrEqual(4.5)
  })
})
