import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUp } from 'lucide-react'
import { t } from '@shared/messages'
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

  // fixed 래퍼가 메인 컨테이너와 같은 max-width·안쪽 여백을 가져, 넓은 화면에서도
  // 버튼이 콘텐츠 오른쪽 안쪽 가장자리에 붙는다. 래퍼는 클릭을 통과시키고 버튼만 받는다.
  return (
    <div data-testid="back-to-top-shell" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 sm:bottom-6">
      <div data-testid="back-to-top-align" className="mx-auto flex w-full max-w-6xl justify-end pr-2 sm:pr-4">
        <Button
          type="button"
          size="icon"
          data-testid="back-to-top"
          data-visible={visible}
          aria-hidden={visible ? undefined : true}
          tabIndex={visible ? 0 : -1}
          aria-label={t('action.backToTop')}
          title={t('action.backToTop')}
          onClick={() => window.scrollTo(prefersReducedMotion() ? { top: 0 } : { top: 0, behavior: 'smooth' })}
          className="back-to-top motion-button pointer-events-auto size-10 rounded-full bg-brand text-brand-foreground shadow-lg hover:bg-brand-hover active:bg-brand-active focus-visible:ring-[3px] focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:focus-visible:ring-white max-[391px]:size-9"
        >
          <ArrowUp aria-hidden="true" className="size-5 max-[391px]:size-4" />
        </Button>
      </div>
    </div>
  )
}
