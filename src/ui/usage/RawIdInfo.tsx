import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { t } from '@shared/messages'

/** 말풍선과 버튼 사이 간격(px)과, 위쪽에 둘 수 있는지 판단할 여유(px). */
const BUBBLE_GAP_PX = 6
/** 말풍선이 뷰포트 좌우 끝에 붙지 않게 두는 최소 여백(px). */
const VIEWPORT_MARGIN_PX = 8

interface BubblePosition {
  below: boolean
  left: number
  top: number
}

/**
 * 버튼·말풍선 크기로 고정(fixed) 좌표를 계산한다. 위쪽 공간이 모자라면 아래쪽,
 * 오른쪽으로 넘치면 뷰포트 안으로 밀어 넣는다(순수 함수라 테스트하기 쉽다).
 */
export function positionBubble(button: DOMRect, bubble: { width: number; height: number }, viewportWidth: number): BubblePosition {
  const below = button.top < bubble.height + BUBBLE_GAP_PX
  const top = below ? button.bottom + BUBBLE_GAP_PX : button.top - BUBBLE_GAP_PX - bubble.height
  const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewportWidth - bubble.width - VIEWPORT_MARGIN_PX)
  const left = Math.min(Math.max(button.left, VIEWPORT_MARGIN_PX), maxLeft)
  return { below, left, top }
}

/**
 * 카드 제목 옆 작은 정보 아이콘: 원본 속성 이름(five_hour 등)을 말풍선으로 보여 준다(의존성 없는 작은 구현).
 * - 열기: 마우스 호버, 키보드 포커스, 탭/클릭(클릭하면 고정되어 호버를 벗어나도 남는다).
 * - 닫기: 두 번째 클릭, 바깥 클릭·탭, Esc, 포커스 이동.
 * - 위치: 버튼 기준 위쪽, 위에 공간이 없으면 아래쪽. body에 포털로 띄우고 position:fixed로 두어
 *   카드·목록 표의 overflow:hidden(특히 좁은 화면 목록 첫 행, Safari에서 보고됨)이나 transform 조상에 잘리지 않는다.
 * 스크린리더에는 항상 읽히는 sr-only 문구를 aria-describedby로 연결하고, 말풍선은 장식이라 aria-hidden이다.
 */
export function RawIdInfo({ id, label }: { id: string; label: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [position, setPosition] = useState<BubblePosition | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const descriptionId = useId()

  const close = (): void => {
    setOpen(false)
    setPinned(false)
  }

  // 열릴 때 버튼 위치로 좌표를 잡고, 열려 있는 동안 스크롤·리사이즈에 따라 다시 잡는다(그리기 전에 계산해 깜빡임이 없다).
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = (): void => {
      if (rootRef.current === null || bubbleRef.current === null) return
      const bubble = bubbleRef.current.getBoundingClientRect()
      setPosition(positionBubble(rootRef.current.getBoundingClientRect(), { width: bubble.width, height: bubble.height }, window.innerWidth))
    }
    update()
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      window.removeEventListener('resize', update)
    }
  }, [open])

  // 열려 있는 동안 바깥 클릭·탭과 Esc로 닫는다.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        data-testid="usage-card-info"
        aria-label={t('card.info.aria', { label })}
        aria-describedby={descriptionId}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setOpen(true)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse' && !pinned) setOpen(false)
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => {
          if (pinned) close()
          else {
            setOpen(true)
            setPinned(true)
          }
        }}
        className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1.5 before:content-[''] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Info aria-hidden="true" className="size-3.5" />
      </button>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            data-testid="usage-card-info-content"
            data-side={position?.below === true ? 'bottom' : 'top'}
            aria-hidden="true"
            className="info-bubble pointer-events-none fixed z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] break-all rounded-md border bg-card px-2.5 py-1.5 font-mono text-xs text-card-foreground shadow-md"
            style={position === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: position.left, top: position.top }}
          >
            {id}
          </span>,
          document.body,
        )}
      <span id={descriptionId} className="sr-only">
        {id}
      </span>
    </span>
  )
}
