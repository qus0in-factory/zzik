import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/ui/motion.css', 'utf8')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

describe('Given the shared motion rules', () => {
  it('Then every transition and animation duration is 150~300ms', () => {
    const durations = [...css.matchAll(/--motion-(?:fast|base)\s*:\s*(\d+)ms/g)].map((match) => Number(match[1]))
    expect(durations.length).toBe(2)
    for (const ms of durations) {
      expect(ms).toBeGreaterThanOrEqual(150)
      expect(ms).toBeLessThanOrEqual(300)
    }
    expect(css).not.toMatch(/\b(?:animation|transition)[^;{]*\b(?:[4-9]\d{2}|\d{4,})ms/)
  })
  it('When reduced motion is requested Then fade-in, button, back-to-top and spinner motion are all turned off', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    for (const selector of ['.fade-in', '.motion-button', '.back-to-top', '.refresh-spinner']) expect(reduced).toContain(selector)
    expect(reduced).toMatch(/animation:\s*none/)
    expect(reduced).toMatch(/transition:\s*none/)
  })
  it('Then the animated surfaces are defined: fade-in, button hover/active, back-to-top enter/exit, spinner', () => {
    for (const rule of ['.fade-in', '.motion-button:hover', '.motion-button:active', ".back-to-top[data-visible='true']", '.refresh-spinner']) expect(css).toContain(rule)
  })
})
