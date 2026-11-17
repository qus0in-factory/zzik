import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import { SiteHeader } from '../SiteHeader'
import desktopSvg from './architecture-desktop.svg?raw'
import mobileSvg from './architecture-mobile.svg?raw'

function Screenshot({ src, width, height, label, className = '' }: { src: string; width: number; height: number; label: string; className?: string }): ReactNode {
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <img
          src={src}
          alt={t('landing.screens.alt', { label })}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-2 text-sm font-medium text-foreground">{label}</figcaption>
    </figure>
  )
}

/** 공개 소개 페이지: 아키텍처와 fixture 스크린샷만 보여 주고 데이터 API를 호출하지 않는다. */
export function LandingPage(): ReactNode {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full flex-1 max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <section className="max-w-3xl">
          <p className="text-xs font-medium tracking-[0.18em] text-brand uppercase">{t('landing.eyebrow')}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t('landing.title')}</h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{t('landing.lead')}</p>
        </section>

        <section aria-labelledby="landing-architecture" className="mt-10">
          <h2 id="landing-architecture" className="text-xl font-semibold tracking-tight">{t('landing.arch.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('landing.arch.lead')}</p>
          <figure className="mt-5 rounded-xl border border-border bg-card p-3 sm:p-5">
            <div aria-hidden="true" className="landing-architecture hidden sm:block" dangerouslySetInnerHTML={{ __html: desktopSvg }} />
            <div aria-hidden="true" className="landing-architecture sm:hidden" dangerouslySetInnerHTML={{ __html: mobileSvg }} />
            <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
              {t('landing.arch.caption')}
              <span className="mt-1 block">{t('landing.arch.source')}</span>
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="landing-screens" className="mt-10">
          <h2 id="landing-screens" className="text-xl font-semibold tracking-tight">{t('landing.screens.title')}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('landing.screens.note')}</p>
          <div className="mt-5 flex flex-col gap-6">
            <Screenshot src="/screenshots/usage-desktop.webp" width={1280} height={900} label={t('landing.screens.usageDesktop')} />
            <Screenshot
              src="/screenshots/usage-mobile.webp"
              width={390}
              height={844}
              label={t('landing.screens.usageMobile')}
              className="mx-auto w-full max-w-[320px]"
            />
            <Screenshot src="/screenshots/usage-chart.webp" width={1280} height={900} label={t('landing.screens.chart')} />
            <Screenshot src="/screenshots/trend.webp" width={1280} height={900} label={t('landing.screens.trend')} />
          </div>
        </section>
      </main>
    </div>
  )
}
