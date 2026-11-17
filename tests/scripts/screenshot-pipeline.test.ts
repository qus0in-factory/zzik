import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Given the README screenshot pipeline', () => {
  it('When it captures the trend screen Then it uses the DEV fixture query and waits for fixture data', () => {
    const source = readFileSync('scripts/update-readme-screenshot.mjs', 'utf8')
    expect(source).toContain('/trend?fixture=normal')
    expect(source).toContain('waitForTrend(page)')
    expect(source).toContain("data-testid=\"' + id + '\"")
    expect(source).toContain("has('trend-treemap-cell')")
  })
})
