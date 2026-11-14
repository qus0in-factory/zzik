import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@ui/components/ui/button'

/** 이 거리(px) 이상 스크롤했을 때만 버튼을 보여준다. */
const SCROLL_THRESHOLD = 400

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 우측 하단 고정 '맨 위로' 버튼. 스크롤 위치에 따라 나타나고 감속 모션 설정을 존중한다. */
export function BackToTop(): ReactNode {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY >= SCROLL_THRESHOLD)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!visible) return null

  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label="맨 위로"
      title="맨 위로"
      onClick={() => window.scrollTo(prefersReducedMotion() ? { top: 0 } : { top: 0, behavior: 'smooth' })}
      className="fixed right-4 bottom-4 z-50 rounded-full shadow-lg sm:right-6 sm:bottom-6"
    >
      <ArrowUp aria-hidden="true" />
    </Button>
  )
}
