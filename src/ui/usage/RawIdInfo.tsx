import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { t } from '@shared/messages'

/** 말풍선과 버튼 사이 간격(px)과, 위쪽에 둘 수 있는지 판단할 여유(px). */
const BUBBLE_GAP_PX = 6

/**
 * 카드 제목 옆 작은 정보 아이콘: 원본 속성 이름(five_hour 등)을 말풍선으로 보여 준다(의존성 없는 작은 구현).
 * - 열기: 마우스 호버, 키보드 포커스, 탭/클릭(클릭하면 고정되어 호버를 벗어나도 남는다).
 * - 닫기: 두 번째 클릭, 바깥 클릭·탭, Esc, 포커스 이동.
 * - 위치: 버튼 기준 위쪽, 위에 공간이 없으면 아래쪽.
 * 스크린리더에는 항상 읽히는 sr-only 문구를 aria-describedby로 연결하고, 말풍선은 장식이라 aria-hidden이다.
 */
export function RawIdInfo({ id, label }: { id: string; label: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [below, setBelow] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const descriptionId = useId()

  const close = (): void => {
    setOpen(false)
    setPinned(false)
  }

  // 열릴 때 위쪽 공간이 부족하면 아래쪽에 둔다.
  useLayoutEffect(() => {
    if (!open || rootRef.current === null || bubbleRef.current === null) return
    const need = bubbleRef.current.getBoundingClientRect().height + BUBBLE_GAP_PX
    setBelow(rootRef.current.getBoundingClientRect().top < need)
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
      {open && (
        <span
          ref={bubbleRef}
          data-testid="usage-card-info-content"
          data-side={below ? 'bottom' : 'top'}
          aria-hidden="true"
          className={
            'info-bubble pointer-events-none absolute left-0 z-30 w-max max-w-[min(20rem,calc(100vw-2rem))] break-all rounded-md border bg-card px-2.5 py-1.5 font-mono text-xs text-card-foreground shadow-md ' +
            (below ? 'top-full mt-1.5' : 'bottom-full mb-1.5')
          }
        >
          {id}
        </span>
      )}
      <span id={descriptionId} className="sr-only">
        {id}
      </span>
    </span>
  )
}
