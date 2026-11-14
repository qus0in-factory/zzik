import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/ui/motion.css', 'utf8')
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))

const ms = (name: string): number => Number(new RegExp(`--${name}\\s*:\\s*(\\d+)ms`).exec(css)?.[1])

describe('Given the shared motion rules', () => {
  it('Then button/UI transitions are 150~300ms, fade-in 300~350ms, entrance 600~800ms with a 40~60ms stagger', () => {
    for (const name of ['motion-fast', 'motion-base']) expect(ms(name)).toBeGreaterThanOrEqual(150), expect(ms(name)).toBeLessThanOrEqual(300)
    expect(ms('motion-fade')).toBeGreaterThanOrEqual(300)
    expect(ms('motion-fade')).toBeLessThanOrEqual(350)
    expect(ms('motion-enter')).toBeGreaterThanOrEqual(600)
    expect(ms('motion-enter')).toBeLessThanOrEqual(800)
    expect(ms('motion-stagger')).toBeGreaterThanOrEqual(40)
    expect(ms('motion-stagger')).toBeLessThanOrEqual(60)
  })
  it('Then fade-in rises by 8px', () => {
    expect(css).toMatch(/@keyframes fade-in\s*\{\s*from\s*\{[^}]*translateY\(8px\)/)
    expect(css).toMatch(/\.fade-in\s*\{\s*animation:\s*fade-in var\(--motion-fade\)/)
  })
  it('Then the progress bar fills from 0 on mount only (backwards fill, so later value changes use the normal transition)', () => {
    expect(css).toMatch(/\.bar-enter\s*\{[^}]*animation:\s*bar-enter var\(--motion-enter\) ease-out backwards/)
    expect(css).toMatch(/@keyframes bar-enter\s*\{\s*from\s*\{\s*transform:\s*translateX\(-100%\)/)
    expect(css).toMatch(/animation-delay:\s*calc\(var\(--enter-index, 0\) \* var\(--motion-stagger\)\)/)
    expect(css).not.toMatch(/\.bar-enter\s*\{[^}]*\b(?:forwards|both)\b/)
  })
  it('Then the entrance and fade-in are also switched off when reduced motion is requested', () => {
    for (const selector of ['.bar-enter', '.activity-gerbil-runner']) expect(reduced).toContain(selector)
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

describe('Given the reorder guard', () => {
  it('Then finished entrance animations are switched off by data-entered so moved DOM nodes do not replay them', () => {
    for (const rule of ['.fade-in[data-entered]', '.bar-enter[data-entered]', '.activity-gerbil-runner[data-entered]']) expect(css).toContain(rule)
    expect(css).toMatch(/\.activity-gerbil-runner\[data-entered\]\[data-gerbil-state='idle'\] \.gerbil-leg/)
  })
})
