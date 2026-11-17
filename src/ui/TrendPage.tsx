import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { t } from '@shared/messages'
import { SiteHeader } from './SiteHeader'
import { TREND_LINKS } from './trend-links'
import { FreeModelsSection } from './trend/FreeModelsSection'
import { NewModelsSection } from './trend/NewModelsSection'

function ComingSoonSection({ id, title }: { id: string; title: string }): ReactNode {
  return (
    <section aria-labelledby={`trend-${id}`} className="mb-8" data-testid={`trend-${id}`}>
      <h2 id={`trend-${id}`} className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('trend.comingSoon')}</p>
    </section>
  )
}

/** 트렌드 화면: 요금제 추가 → 최신 → free → 성능 → 참고 링크 순서. 미구현 섹션은 자리만 둔다. */
export function TrendPage(): ReactNode {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full flex-1 max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <ComingSoonSection id="plan-models" title={t('trend.planModels.title')} />
        <NewModelsSection />
        <FreeModelsSection />
        <ComingSoonSection id="metrics" title={t('trend.metrics.title')} />
        <section aria-labelledby="trend-links">
          <h2 id="trend-links" className="text-xl font-semibold tracking-tight">{t('trend.links.title')}</h2>
          <ul aria-label={t('trend.links.aria')} className="mt-3 flex flex-col gap-2">
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
        </section>
      </main>
    </div>
  )
}
