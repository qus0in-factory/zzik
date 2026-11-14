import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chartCss = readFileSync('src/ui/usage/history/chart.css', 'utf8')
const mainCss = readFileSync('src/ui/index.css', 'utf8')
const pkg = JSON.parse(readFileSync('node_modules/uplot/package.json', 'utf8')) as { version: string; license: string }
const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function rootColors(): string[] {
  const root = chartCss.slice(chartCss.indexOf(':root {'), chartCss.indexOf('.dark {'))
  return [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => {
    const match = new RegExp(`--chart-${slot}:\\s*(#[0-9a-fA-F]{6})`).exec(root)
    expect(match, `--chart-${slot} missing from :root`).not.toBeNull()
    return match![1]
  })
}

describe('Given the chart colour tokens (lazy chunk CSS)', () => {
  it('Then all eight palette colours clear 3.3:1 against a white card', () => {
    for (const hex of rootColors()) {
      expect(1.05 / (luminance(hex) + 0.05)).toBeGreaterThanOrEqual(3.3)
    }
  })

  it('Then dark mode overrides all eight chart colours through CSS variables', () => {
    const dark = chartCss.slice(chartCss.indexOf('.dark {'))
    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8]) expect(dark).toContain(`--chart-${slot}:`)
    expect(dark).toContain('--chart-surface:')
    expect(dark).toContain('--chart-grid:')
  })

  it('Then every slot 0~8 is mapped to a colour by data-slot', () => {
    for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8]) expect(chartCss).toContain(`[data-slot='${slot}']`)
  })

  it('Then uPlot CSS and the main bundle stay untouched by chart tokens', () => {
    expect(chartCss).toContain("@import 'uplot/dist/uPlot.min.css'")
    expect(mainCss).not.toContain('--chart-1')
  })
})

describe('Given the uPlot dependency', () => {
  it('Then it is pinned to an exact version and the MIT licence is recorded', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }
    expect(manifest.dependencies.uplot).toBe(pkg.version)
    expect(manifest.dependencies.uplot).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.license).toBe('MIT')
    expect(notices).toContain(`uPlot ${pkg.version}`)
    expect(notices).toContain('MIT License')
  })
})

describe('Given accessibility and reduced motion', () => {
  it('Then the range input is clipped (focusable) and horizontal touch dragging is allowed', () => {
    expect(chartCss).toContain('.chart-range-input')
    expect(chartCss).toContain('clip: rect(0, 0, 0, 0)')
    const rangeInput = chartCss.slice(chartCss.indexOf('.chart-range-input {'), chartCss.indexOf('.chart-legend {'))
    expect(rangeInput).not.toContain('display: none')
    expect(chartCss).toContain('touch-action: pan-y')
  })

  it('Then the accessibility table is visually hidden, not removed', () => {
    expect(chartCss).toContain('.chart-a11y')
    expect(chartCss).toContain('clip: rect(0, 0, 0, 0)')
  })

  it('Then reduced motion kills panel entrance and series toggle transitions', () => {
    expect(chartCss).toContain('@media (prefers-reduced-motion: reduce)')
    for (const selector of ['.usage-history-panel', '.usage-history-chart', '.chart-legend-item', '.chart-range-tab', '.chart-show-all', '.chart-tooltip', '.chart-skeleton', '.chart-retry']) {
      expect(chartCss).toContain(selector)
    }
    expect(chartCss).toContain('transition: none')
  })

  it('Then the uPlot default legend is hidden and a single custom tooltip is styled', () => {
    expect(chartCss).toContain('.chart-canvas-host .u-legend')
    expect(chartCss).toContain('display: none')
    expect(chartCss).toContain('.chart-tooltip')
    expect(chartCss).toContain('.chart-tooltip[hidden]')
    expect(chartCss).toContain('--chart-tooltip-bg')
  })

  it('Then forced-colors turns on dashes for the first three slots too', () => {
    expect(chartCss).toContain('@media (forced-colors: active)')
    for (const slot of ['1', '2', '3']) expect(chartCss).toContain(`.chart-swatch-line[data-slot='${slot}']`)
  })
})
