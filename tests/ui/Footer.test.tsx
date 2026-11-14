// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Footer, GITHUB_REPO_URL } from '@ui/components/Footer'

afterEach(cleanup)

describe('Given the page footer (버전 + GitHub 링크)', () => {
  it('When rendered Then it shows the version as vX.Y.Z', () => {
    render(<Footer version="0.6.0" />)
    expect(screen.getByTestId('app-version').textContent).toBe('v0.6.0')
    expect(screen.getByRole('contentinfo')).toBeTruthy()
  })
  it('Then the link opens the repository safely in a new tab with an accessible name and title', () => {
    render(<Footer version="0.6.0" />)
    const link = screen.getByRole('link', { name: '저장소 열기' })
    expect(link.getAttribute('href')).toBe('https://github.com/qus0in-factory/zzik')
    expect(GITHUB_REPO_URL).toBe('https://github.com/qus0in-factory/zzik')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('title')).toBe('저장소 열기')
    expect(link.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
  })
  it('Then the footer is small and muted and keeps clear of the floating back-to-top button (bottom padding)', () => {
    render(<Footer version="0.6.0" />)
    const className = screen.getByRole('contentinfo').className
    expect(className).toContain('text-xs')
    expect(className).toContain('text-muted-foreground')
    expect(className).toMatch(/pb-16/)
  })
  it('Then the injected build version equals package.json (not hard-coded)', () => {
    expect(__APP_VERSION__).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version)
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('When no version prop is given Then the build-time version is used', () => {
    render(<Footer />)
    expect(screen.getByTestId('app-version').textContent).toBe(`v${__APP_VERSION__}`)
  })
})
