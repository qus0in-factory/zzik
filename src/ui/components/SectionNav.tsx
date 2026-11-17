import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link, useLocation } from 'react-router'

export interface SectionNavItem {
  id: string
  label: string
}

export interface SectionNavProps {
  pathname: string
  ariaLabel: string
  sections: readonly SectionNavItem[]
  /** 제공하면 mainRef 내부에서 실제 렌더된 섹션만 표시 대상으로 감지한다(예: /trend). */
  mainRef?: RefObject<HTMLElement | null>
  /** DOM에 자식이 없을 때 숨길지 여부(/trend는 데이터 없으면 섹션을 숨김). */
  hideEmpty?: boolean
  /** --section-nav-offset CSS 변수 변경 시 콜백. */
  onOffsetChange?: (offset: string) => void
}

/** 헤더 아래 고정 섹션 이동 줄(sticky, 현재 섹션 aria-current, 해시 복원, scroll-margin 변수 설정). */
export function SectionNav({
  pathname,
  ariaLabel,
  sections,
  mainRef,
  hideEmpty = false,
  onOffsetChange,
}: SectionNavProps): ReactNode {
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)
  const hashIntent = useRef(true)
  const [visibleIds, setVisibleIds] = useState<string[]>(() => sections.map((s) => s.id))
  const [current, setCurrent] = useState<string>(() => sections[0]?.id ?? '')
  const [navHeight, setNavHeight] = useState(0)
  const [headerHeight, setHeaderHeight] = useState(0)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const header = nav.previousElementSibling
    const update = () => {
      const nh = nav.getBoundingClientRect().height
      const hh = header?.getBoundingClientRect().height ?? 0
      setNavHeight(nh)
      setHeaderHeight(hh)
      const offset = `calc(var(--site-header-height, 0px) + ${nh}px + 8px)`
      document.documentElement.style.setProperty('--section-nav-offset', offset)
      onOffsetChange?.(offset)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(nav)
    if (header) observer?.observe(header)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--section-nav-offset')
    }
  }, [onOffsetChange])

  useEffect(() => {
    const update = () => {
      const next = hideEmpty
        ? sections.filter((s) => {
            const el = document.getElementById(s.id)
            return el !== null && (el.tagName === 'SECTION' ? el.childElementCount > 0 : el.childElementCount > 0)
          }).map((s) => s.id)
        : sections.map((s) => s.id)
      setVisibleIds((prev) => (prev.join(',') === next.join(',') ? prev : next))
      setCurrent((prev) => (next.includes(prev) ? prev : (next[0] ?? '')))
    }
    update()
    const root = mainRef?.current
    if (!hideEmpty || !root || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(update)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [sections, hideEmpty, mainRef])

  const hashId = location.hash.slice(1)
  const hashAvailable = visibleIds.includes(hashId)

  useEffect(() => {
    navRef.current?.querySelector<HTMLAnchorElement>('a[aria-current="location"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current, visibleIds])

  useEffect(() => {
    hashIntent.current = true
    if (hashAvailable) setCurrent(hashId)
  }, [hashId, hashAvailable])

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
    const restore = () => {
      if (hashIntent.current && hashAvailable) document.getElementById(hashId)?.scrollIntoView?.()
    }
    restore()
    if (!hashId || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(restore)
    const targetIndex = sections.findIndex((s) => s.id === hashId)
    if (targetIndex < 0) return
    for (const section of sections.slice(0, targetIndex + 1)) {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [hashId, hashAvailable, headerHeight, navHeight, sections])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
      const first = sections.find((s) => visible.has(s.id))
      if (atBottom && visibleIds.length > 0) setCurrent(visibleIds[visibleIds.length - 1]!)
      else if (first) setCurrent(first.id)
    }, { rootMargin: `-${headerHeight + navHeight}px 0px -60% 0px` })

    for (const section of sections) {
      const element = document.getElementById(section.id)
      if (element && visibleIds.includes(section.id)) observer.observe(element)
    }
    const onScroll = () => {
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1 && visibleIds.length > 0) {
        setCurrent(visibleIds[visibleIds.length - 1]!)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [sections, visibleIds, navHeight, headerHeight])

  return (
    <nav ref={navRef} aria-label={ariaLabel} className="sticky top-[var(--site-header-height,0px)] z-30 border-b bg-card">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
        {sections.filter((section) => visibleIds.includes(section.id)).map((section) => (
          <Link
            key={section.id}
            to={{ pathname, search: location.search, hash: `#${section.id}` }}
            aria-current={current === section.id ? 'location' : undefined}
            onClick={() => {
              hashIntent.current = true
              setCurrent(section.id)
              if (location.hash === `#${section.id}`) document.getElementById(section.id)?.scrollIntoView?.()
            }}
            className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${current === section.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
