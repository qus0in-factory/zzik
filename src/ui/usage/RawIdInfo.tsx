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

interface Viewport {
  width: number
  height: number
}

/** 버튼이 뷰포트 안에 한 픽셀이라도 보이는지(스크롤로 완전히 벗어나면 말풍선을 닫는다). 크기 0(레이아웃 전·jsdom)은 판정하지 않는다. */
export function isButtonInViewport(button: DOMRect, viewport: Viewport): boolean {
  if (button.width === 0 && button.height === 0) return true
  return button.bottom > 0 && button.top < viewport.height && button.right > 0 && button.left < viewport.width
}

/**
 * 버튼·말풍선 크기로 고정(fixed) 좌표를 계산한다. 기본은 버튼 위쪽, 위에 공간이 없고 아래에 있으면 아래쪽,
 * 둘 다 없으면 위쪽(낮은 뷰포트에서 아래로 밀려 잘리지 않게). 오른쪽으로 넘치면 뷰포트 안으로 밀어 넣는다(순수 함수).
 */
export function positionBubble(button: DOMRect, bubble: { width: number; height: number }, viewport: Viewport): BubblePosition {
  const need = bubble.height + BUBBLE_GAP_PX
  const roomAbove = button.top >= need
  const roomBelow = viewport.height - button.bottom >= need
  const below = !roomAbove && roomBelow
  const top = below ? button.bottom + BUBBLE_GAP_PX : button.top - BUBBLE_GAP_PX - bubble.height
  const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewport.width - bubble.width - VIEWPORT_MARGIN_PX)
  const left = Math.min(Math.max(button.left, VIEWPORT_MARGIN_PX), maxLeft)
  return { below, left, top }
}

function samePosition(a: BubblePosition | null, b: BubblePosition): boolean {
  return a !== null && a.below === b.below && a.left === b.left && a.top === b.top
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

  // 열릴 때 버튼 위치로 좌표를 잡고(그리기 전에 계산해 깜빡임이 없다), 열려 있는 동안 매 프레임 다시 잰다.
  // 스크롤·리사이즈뿐 아니라 카드 재배치처럼 이벤트 없는 레이아웃 변화도 따라가고, 값이 같으면 다시 그리지 않는다.
  // 버튼이 뷰포트 밖으로 나가거나 고정 헤더 등 다른 요소에 덮이면(중심점 히트 테스트) 닫는다.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    let frame = 0
    const update = (): void => {
      const root = rootRef.current
      const bubble = bubbleRef.current
      if (root === null || bubble === null) return
      const button = root.getBoundingClientRect()
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2) : null
      const measurable = button.width > 0 || button.height > 0
      const covered = measurable && hit !== null && hit !== undefined && !root.contains(hit)
      if (!isButtonInViewport(button, viewport) || covered) {
        close()
        return
      }
      const size = bubble.getBoundingClientRect()
      const next = positionBubble(button, { width: size.width, height: size.height }, viewport)
      setPosition((current) => (samePosition(current, next) ? current : next))
    }
    const tick = (): void => {
      update()
      frame = window.requestAnimationFrame(tick)
    }
    update()
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
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
