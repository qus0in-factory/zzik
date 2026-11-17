import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { ExternalLink } from 'lucide-react'
import { t } from '@shared/messages'
import { SiteHeader } from './SiteHeader'
import { BackToTop } from './components/BackToTop'
import { Footer } from './components/Footer'
import { TREND_LINKS } from './trend-links'
import { FreeModelsSection } from './trend/FreeModelsSection'
import { MetricsSection } from './trend/MetricsSection'
import { NewModelsSection } from './trend/NewModelsSection'

const SECTIONS = [
  { id: 'metrics', label: 'trend.metrics.title' },
  { id: 'new-models', label: 'trend.newModels.title' },
  { id: 'free-models', label: 'trend.freeModels.title' },
  { id: 'links', label: 'trend.links.title' },
] as const

/** 트렌드 화면: 성능 지표 → 신규 모델 → 무료 모델 → 참고 링크 순서. */
export function TrendPage(): ReactNode {
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const hashIntent = useRef(true)
  const [visibleSections, setVisibleSections] = useState<string[]>(['links'])
  const [current, setCurrent] = useState('metrics')
  const [navHeight, setNavHeight] = useState(0)
  const [headerHeight, setHeaderHeight] = useState(0)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const header = nav.previousElementSibling
    const update = () => {
      setNavHeight(nav.getBoundingClientRect().height)
      setHeaderHeight(header?.getBoundingClientRect().height ?? 0)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(nav)
    if (header) observer?.observe(header)
    window.addEventListener('resize', update)
    return () => { observer?.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const update = () => {
      const visible: string[] = SECTIONS.filter((section) => section.id === 'links' || (document.getElementById(section.id)?.childElementCount ?? 0) > 0).map((section) => section.id)
      setVisibleSections((previous) => previous.join(',') === visible.join(',') ? previous : visible)
      setCurrent((previous) => visible.includes(previous) ? previous : visible[0]!)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(main, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  const hashAvailable = visibleSections.includes(location.hash.slice(1))
  useEffect(() => {
    hashIntent.current = true
  }, [location.hash])
  useEffect(() => {
    const cancel = () => { hashIntent.current = false }
    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchstart', cancel, { passive: true })
    window.addEventListener('keydown', cancel)
    window.addEventListener('pointerdown', cancel)
    return () => {
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.removeEventListener('keydown', cancel)
      window.removeEventListener('pointerdown', cancel)
    }
  }, [])
  useEffect(() => {
    const id = location.hash.slice(1)
    const restore = () => {
      if (hashIntent.current && hashAvailable) document.getElementById(id)?.scrollIntoView?.()
    }
    restore()
    if (!id || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(restore)
    const targetIndex = SECTIONS.findIndex((section) => section.id === id)
    if (targetIndex < 0) return
    for (const section of SECTIONS.slice(0, targetIndex + 1)) {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [location.hash, hashAvailable, headerHeight, navHeight])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
      const first = SECTIONS.find((section) => visible.has(section.id))
      if (atBottom) setCurrent(visibleSections[visibleSections.length - 1]!)
      else if (first) setCurrent(first.id)
    }, { rootMargin: `-${headerHeight + navHeight}px 0px -60% 0px` })
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id)
      if (element && visibleSections.includes(section.id)) observer.observe(element)
    }
    const onScroll = () => {
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) setCurrent(visibleSections[visibleSections.length - 1]!)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { observer.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [visibleSections, navHeight, headerHeight])
  const offset = `calc(var(--site-header-height, 0px) + ${navHeight}px + 8px)`

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <nav ref={navRef} aria-label={t('trend.sections.aria')} className="sticky top-[var(--site-header-height,0px)] z-30 border-b bg-card">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          {SECTIONS.filter((section) => visibleSections.includes(section.id)).map((section) => (
            <Link key={section.id} to={{ pathname: '/trend', search: location.search, hash: `#${section.id}` }} aria-current={current === section.id ? 'location' : undefined}
              onClick={() => { hashIntent.current = true; if (location.hash === `#${section.id}`) document.getElementById(section.id)?.scrollIntoView?.() }}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${current === section.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
              {t(section.label)}
            </Link>
          ))}
        </div>
      </nav>
      <main ref={mainRef} className="mx-auto w-full flex-1 max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div id="metrics" style={{ scrollMarginTop: offset }}><MetricsSection /></div>
        <div id="new-models" style={{ scrollMarginTop: offset }}><NewModelsSection /></div>
        <div id="free-models" style={{ scrollMarginTop: offset }}><FreeModelsSection /></div>
        <section id="links" style={{ scrollMarginTop: offset }} aria-labelledby="trend-links">
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
                    <span className="text-xs leading-5 text-muted-foreground">{t(link.descriptionKey)}</span>
                  </span>
                  <ExternalLink className="size-[14px] shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <Footer />
      <BackToTop />
    </div>
  )
}
