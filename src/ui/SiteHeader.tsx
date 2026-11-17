import { Link, useLocation } from 'react-router'
import type { ReactNode } from 'react'
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
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold tracking-tight">
          <HomeLink>
            <img src="/favicon.svg" alt="" width={32} height={32} className="size-8 rounded-lg" />
            <span>{t('app.title')}</span>
          </HomeLink>
        </h1>
        <nav aria-label={t('nav.aria')} className="flex items-center gap-1 whitespace-nowrap">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to
            return (
              <Link
                key={item.to}
                to={{ pathname: item.to, search: location.search }}
                aria-current={active ? 'page' : undefined}
                className={navLinkClassName(active)}
              >
                {t(item.label)}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
