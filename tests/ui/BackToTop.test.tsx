// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BackToTop } from '@ui/components/BackToTop'

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value })
}

function stubReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  setScrollY(0)
  stubReducedMotion(false)
  scrollTo = vi.fn()
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function queryTopButton() {
  return screen.queryByRole('button', { name: '맨 위로' })
}

describe('Given the back-to-top floating button (등장/퇴장 트랜지션)', () => {
  it('When the viewport is 390px or narrower Then the button shrinks and hugs the page gutter instead of covering the card corner', () => {
    render(<BackToTop />)
    const { className } = screen.getByTestId('back-to-top')
    for (const rule of ['max-[391px]:size-8', 'max-[391px]:right-2', 'max-[391px]:bottom-2']) expect(className).toContain(rule)
  })

  it('When hidden Then it stays mounted for the exit transition but is out of the accessibility tree and unfocusable', () => {
    render(<BackToTop />)
    const hidden = screen.getByTestId('back-to-top')
    expect(hidden.getAttribute('data-visible')).toBe('false')
    expect(hidden.getAttribute('aria-hidden')).toBe('true')
    expect(hidden.tabIndex).toBe(-1)
    setScrollY(800)
    fireEvent.scroll(window)
    const shown = screen.getByTestId('back-to-top')
    expect(shown.getAttribute('data-visible')).toBe('true')
    expect(shown.getAttribute('aria-hidden')).toBeNull()
    expect(shown.tabIndex).toBe(0)
  })

  it('When the page is near the top Then the button is not shown', () => {
    render(<BackToTop />)
    expect(queryTopButton()).toBeNull()
  })

  it('When scrolled past the threshold Then it appears and hides again on the way back up', () => {
    render(<BackToTop />)
    setScrollY(399)
    fireEvent.scroll(window)
    expect(queryTopButton()).toBeNull()

    setScrollY(400)
    fireEvent.scroll(window)
    expect(queryTopButton()).not.toBeNull()

    setScrollY(120)
    fireEvent.scroll(window)
    expect(queryTopButton()).toBeNull()
  })

  it('When clicked Then it asks the window to scroll smoothly to the top', () => {
    render(<BackToTop />)
    setScrollY(800)
    fireEvent.scroll(window)
    const button = queryTopButton()
    expect(button?.getAttribute('type')).toBe('button')

    fireEvent.click(button!)

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('When reduced motion is preferred Then it jumps to the top without smooth scrolling', () => {
    stubReducedMotion(true)
    render(<BackToTop />)
    setScrollY(800)
    fireEvent.scroll(window)

    fireEvent.click(queryTopButton()!)

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  it('When the button is shown Then it is keyboard focusable and labeled for screen readers', () => {
    render(<BackToTop />)
    setScrollY(800)
    fireEvent.scroll(window)
    const button = queryTopButton()

    button!.focus()

    expect(document.activeElement).toBe(button)
    expect(button?.getAttribute('aria-label')).toBe('맨 위로')
  })
})
