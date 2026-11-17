import { NavLink, useLocation } from 'react-router'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { t } from '@shared/messages'
import { HomeLink } from './components/HomeLink'

const NAV_ITEMS = [
  { to: '/usage', label: 'nav.usage' },
  { to: '/trend', label: 'nav.trend' },
] as const

function navLinkClassName(active: boolean): string {
  return [
    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium no-underline transition-colors',
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
    active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  ].join(' ')
}

/** 사이트 공통 헤더: 로고·제목과 사용량/트렌드 상단 nav. */
export function SiteHeader(): ReactNode {
  const location = useLocation()
  const headerRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const update = () => document.documentElement.style.setProperty('--site-header-height', `${header.getBoundingClientRect().height}px`)
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(header)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); document.documentElement.style.removeProperty('--site-header-height') }
  }, [])
  return (
    <header ref={headerRef} className="sticky top-0 z-40 border-b bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold tracking-tight">
          <HomeLink>
            <img src="/favicon.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
            <span>{t('app.title')}</span>
          </HomeLink>
        </h1>
        <nav aria-label={t('nav.aria')} className="flex items-center gap-1 whitespace-nowrap">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={{ pathname: item.to, search: location.search }}
              className={({ isActive }) => navLinkClassName(isActive)}
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}
