import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { t } from '@shared/messages'
import { SiteHeader } from './SiteHeader'
import { TREND_LINKS } from './trend-links'

/** 트렌드 화면: 외부 참고 링크만 둔다. 데이터를 호출하지 않는다. */
export function TrendPage(): ReactNode {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full flex-1 max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <ul aria-label={t('trend.links.aria')} className="flex flex-col gap-2">
          {TREND_LINKS.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="motion-button flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-3 text-sm transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium">{t(link.nameKey)}</span>
                  <span className="text-xs text-muted-foreground">{t(link.domainKey)}</span>
                </span>
                <ExternalLink className="size-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
