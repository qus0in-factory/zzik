// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeLink } from '@ui/components/HomeLink'

afterEach(cleanup)

describe('Given the header home link (로고 + 제목)', () => {
  const setup = () => {
    const navigate = vi.fn()
    render(
      <HomeLink navigate={navigate}>
        <img src="/icon-192.png" alt="" />
        <span>Zzik : AI 사용량 대시보드</span>
      </HomeLink>,
    )
    return { navigate, link: screen.getByTestId('home-link') }
  }
  it('Then it is a plain link to the site root with an accessible name, wrapping logo and title', () => {
    const { link } = setup()
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/')
    expect(link.getAttribute('aria-label')).toBe('홈으로 이동')
    expect(link.textContent).toBe('Zzik : AI 사용량 대시보드')
    expect(link.querySelector('img')).toBeTruthy()
  })
  it('When clicked Then it goes to "/" with a full navigation (no hash, no query), even from a hash URL', () => {
    window.history.replaceState(null, '', '/?fixture=normal#usage-claude')
    const { navigate, link } = setup()
    const notPrevented = fireEvent.click(link)
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/')
    expect(notPrevented).toBe(false) // 기본 동작(해시 이동)은 막고 직접 이동한다
  })
  it('When clicked with a modifier key or the middle button Then the browser default is kept (새 탭 등)', () => {
    const { navigate, link } = setup()
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(fireEvent.click(link, { button: 1 })).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })
  it('Then it is keyboard focusable and looks like the old title (no underline, soft hover, focus ring)', () => {
    const { link } = setup()
    link.focus()
    expect(document.activeElement).toBe(link)
    for (const rule of ['no-underline', 'hover:opacity-80', 'focus-visible:ring-[3px]']) expect(link.className).toContain(rule)
  })
})
