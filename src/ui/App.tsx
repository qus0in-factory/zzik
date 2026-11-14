import { useEffect, useLayoutEffect, useRef } from 'react'
import { t } from '@shared/messages'
import { useProviderOrder } from '@app/usage/ProviderOrderContext'
import { BackToTop } from '@ui/components/BackToTop'
import { PaceChips } from '@ui/usage/PaceChips'
import { UsageSection } from '@ui/usage/UsageSection'

const FLIP_MS = 200

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 진입 연출이 끝난 요소에 data-entered를 붙인다. 순서를 바꾸면 React가 DOM 노드를 옮기는데(제거 후 삽입),
 * 노드가 다시 삽입되면 CSS 애니메이션이 처음부터 재생되므로, 끝난 연출은 CSS에서 꺼 둔다(진입 연출은 첫 마운트 때만).
 */
function useEntranceGuard(): void {
  useEffect(() => {
    const onEnd = (event: AnimationEvent): void => {
      if (event.target instanceof Element) event.target.closest('.fade-in, .bar-enter, .activity-gerbil-runner')?.setAttribute('data-entered', '')
    }
    document.addEventListener('animationend', onEnd)
    return () => document.removeEventListener('animationend', onEnd)
  }, [])
}

/**
 * 섹션 재배치 FLIP: 순서가 바뀌면 각 섹션이 이전 위치에서 새 위치로 200ms 미끄러진다(reduced-motion이면 즉시).
 * 이전 위치는 순서를 바꾸기 직전(captureTops)에 잰다 — 비동기 로딩으로 높이가 바뀐 뒤에도 정확하다.
 */
function useSectionFlip(order: readonly string[]): { mainRef: React.RefObject<HTMLElement | null>; captureTops: () => void } {
  const mainRef = useRef<HTMLElement | null>(null)
  const before = useRef<Map<string, number> | null>(null)
  const sections = (): HTMLElement[] => [...(mainRef.current?.querySelectorAll<HTMLElement>(':scope > section[data-provider]') ?? [])]
  const captureTops = (): void => {
    before.current = new Map(sections().map((element) => [element.dataset.provider ?? '', element.getBoundingClientRect().top + window.scrollY]))
  }
  useLayoutEffect(() => {
    const previous = before.current
    before.current = null
    if (previous === null || prefersReducedMotion()) return
    for (const element of sections()) {
      const old = previous.get(element.dataset.provider ?? '')
      const top = element.getBoundingClientRect().top + window.scrollY
      if (old !== undefined && Math.abs(old - top) > 1 && typeof element.animate === 'function') {
        element.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'ease-out' })
      }
    }
  }, [order])
  return { mainRef, captureTops }
}

export default function App() {
  const { order } = useProviderOrder()
  const { mainRef, captureTops } = useSectionFlip(order)
  useEntranceGuard()
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
            <img src="/icon-192.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
            <span>{t('app.title')}</span>
          </h1>
        </div>
      </header>
      <main ref={mainRef} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PaceChips onBeforeMove={captureTops} />
        {order.map((provider) => (
          <UsageSection key={provider} provider={provider} />
        ))}
      </main>
      <BackToTop />
    </div>
  )
}
