import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent, ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import type { UsageProvider } from '@domain/usage/providers'
import { t } from '@shared/messages'
import { providerMetaFor } from '@app/usage/provider-meta'
import { useProviderOrder } from '@app/usage/ProviderOrderContext'
import { nearestIndex, shiftDirection, stepIndex } from '@app/usage/reorder-session'
import { summaryPaceOf } from '@app/usage/summary-pace'
import { Skeleton } from '@ui/components/ui/skeleton'
import { ProviderIcon } from './ProviderIcon'
import { ViewModeToggle } from './ViewModeToggle'
import { useUsage } from '@app/usage/useUsage'

/**
 * 제공자별 페이스 칩 줄: 가장 긴 주기 한도 하나의 `사용률 / 예상 사용률`(`[아이콘] W 12% / 59%`(월간은 M)).
 * 사용률이 예상을 넘으면 주의 색으로 칠한다. 한도를 고르는 판정은 app(summaryPaceOf)이 하고 ui는 옮기기만 한다.
 * 월·주 한도나 경과율이 없는 제공자는 칩을 그리지 않는다.
 *
 * 칩을 끌어 제공자 순서를 바꾼다(섹션 순서도 같은 값을 따른다). 마우스는 4px 이상 끌면, 터치는 350ms 길게 눌러야
 * 시작해 가로 스크롤과 충돌하지 않는다. 키보드는 칩에서 Space로 잡고 ←/→로 옮겨 Space/Enter로 놓고 Esc로 취소한다.
 * 끄는 동안에는 DOM 순서를 바꾸지 않고 transform으로만 보여 주다가 놓을 때 한 번에 순서를 확정한다
 * (끄는 도중 노드가 옮겨져 포인터 캡처·포커스를 잃는 것을 피한다).
 */
const MOUSE_DRAG_THRESHOLD_PX = 4
const TOUCH_HOLD_MS = 350
const TOUCH_CANCEL_MOVE_PX = 8
const EDGE_SCROLL_ZONE_PX = 28
const EDGE_SCROLL_STEP_PX = 10

/** 첫 로딩 중 칩 자리만 잡아 데이터가 들어와도 줄 높이가 변하지 않게 한다. */
function PaceChipSkeleton(): ReactNode {
  return (
    <li data-testid="usage-pace-skeleton" aria-hidden="true" className="shrink-0">
      <Skeleton className="h-[30px] w-24 rounded-full" />
    </li>
  )
}

interface ChipDragProps {
  /** 끌기·키보드 이동 중 이 칩에 적용할 가로 이동(px) */
  shift: number
  /** 이 칩이 지금 잡혀 있는가 */
  grabbed: boolean
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onBlur: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}

function PaceChip({ provider, drag }: { provider: UsageProvider; drag: ChipDragProps }): ReactNode {
  const { state } = useUsage(provider)
  const pace = state.report === null ? null : summaryPaceOf(state.report.windows, provider)
  if (state.status === 'loading') return <PaceChipSkeleton />
  if (pace === null) return null
  const meta = providerMetaFor(provider)
  const used = Math.round(pace.usedPercent)
  const expected = Math.round(pace.elapsedPercent)
  const style: CSSProperties = drag.shift === 0 ? {} : { transform: `translateX(${drag.shift}px)` }
  return (
    <li
      data-chip-id={provider}
      data-grabbed={drag.grabbed}
      style={style}
      className={'shrink-0 select-none [-webkit-touch-callout:none] transition-transform duration-150 motion-reduce:transition-none ' + (drag.grabbed ? 'relative z-20 cursor-grabbing transition-none' : '')}
    >
      <a
        href={`#${meta.sectionId}`}
        draggable={false}
        data-testid={`usage-pace-${provider}`}
        data-over-pace={pace.overPace}
        title={t('chips.title', { provider: meta.title, period: t(pace.unit === 'month' ? 'chips.period.month' : 'chips.period.week'), used, expected })}
        aria-describedby="pace-chips-help"
        onPointerDown={drag.onPointerDown}
        onKeyDown={drag.onKeyDown}
        onBlur={drag.onBlur}
        onContextMenu={drag.onContextMenu}
        onFocus={(event) => event.currentTarget.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })}
        className={
          'fade-in inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border bg-card px-1 py-1 text-[11px] font-medium hover:bg-accent lg:gap-1.5 lg:px-2.5 lg:text-sm ' +
          (pace.overPace ? 'border-[var(--usage-caution)] text-[var(--usage-caution)] ' : 'border-border ') +
          (drag.grabbed ? 'shadow-md ring-2 ring-ring' : '')
        }
      >
        <ProviderIcon provider={provider} label={meta.title} className="size-3 lg:size-4" />
        <span className="tabular-nums">
          {t(pace.unit === 'month' ? 'chips.unit.month' : 'chips.unit.week')} {used}% / {expected}%
        </span>
      </a>
    </li>
  )
}

interface DragState {
  id: UsageProvider
  mode: 'pointer' | 'keyboard'
  ids: UsageProvider[]
  originIndex: number
  targetIndex: number
  /** 끌고 있는 칩의 이동량(px) */
  dx: number
  centers: number[]
  widths: number[]
  gap: number
}

function visibleChips(list: HTMLElement | null): { id: UsageProvider; rect: DOMRect }[] {
  if (list === null) return []
  return [...list.querySelectorAll<HTMLElement>('[data-chip-id]')].map((element) => ({ id: element.dataset.chipId as UsageProvider, rect: element.getBoundingClientRect() }))
}

export function PaceChips({ onBeforeMove }: { onBeforeMove?: () => void }): ReactNode {
  const { order, customized, move, reset } = useProviderOrder()
  const listRef = useRef<HTMLUListElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const dragRef = useRef<DragState | null>(null)
  const refocus = useRef<UsageProvider | null>(null)
  const suppressClick = useRef(false)
  const pending = useRef<{ id: UsageProvider; pointerId: number; startX: number; startY: number; timer: number | null; moved: boolean; pointerType: string } | null>(null)
  /** 드래그 기준(포인터를 누른 x). 끄는 동안 이동량 계산에 쓴다. */
  const dragOriginX = useRef(0)
  /** 진행 중인 포인터 제스처의 정리(window 리스너·포인터 캡처·타이머). 언마운트와 제스처 끝에서 부른다. */
  const teardown = useRef<(() => void) | null>(null)
  const clickTimer = useRef<number | null>(null)
  const scrollStart = useRef(0)
  dragRef.current = drag

  const begin = (id: UsageProvider, mode: DragState['mode']): DragState | null => {
    const chips = visibleChips(listRef.current)
    const originIndex = chips.findIndex((chip) => chip.id === id)
    if (originIndex === -1) return null
    scrollStart.current = listRef.current?.scrollLeft ?? 0
    const gap = chips.length > 1 ? Math.max(0, chips[1].rect.left - chips[0].rect.right) : 4
    return {
      id,
      mode,
      ids: chips.map((chip) => chip.id),
      originIndex,
      targetIndex: originIndex,
      dx: 0,
      centers: chips.map((chip) => chip.rect.left + chip.rect.width / 2),
      widths: chips.map((chip) => chip.rect.width),
      gap,
    }
  }

  const commit = (state: DragState): void => {
    const targetId = state.ids[state.targetIndex]
    setDrag(null)
    if (state.targetIndex === state.originIndex || targetId === undefined) {
      setAnnouncement(t('chips.droppedSame', { provider: providerMetaFor(state.id).title }))
      return
    }
    onBeforeMove?.()
    refocus.current = state.id
    move(state.id, order.indexOf(targetId))
    setAnnouncement(t('chips.dropped', { provider: providerMetaFor(state.id).title, position: state.targetIndex + 1 }))
  }

  // 놓은 뒤 DOM이 옮겨지면 포커스가 사라지므로 같은 칩에 다시 둔다.
  useEffect(() => {
    if (refocus.current === null) return
    const id = refocus.current
    refocus.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-chip-id="${id}"] a`)?.focus({ preventScroll: true })
  }, [order])

  // 길게 누르기로 잡은 터치 드래그가 가로 스크롤로 넘어가지 않게, 드래그 중 touchmove를 막는다(non-passive).
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const block = (event: TouchEvent): void => {
      if (dragRef.current?.mode === 'pointer' && event.cancelable) event.preventDefault()
    }
    list.addEventListener('touchmove', block, { passive: false })
    return () => list.removeEventListener('touchmove', block)
  }, [])

  const startPointerDrag = (id: UsageProvider, element: HTMLElement, pointerId: number, originX: number): DragState | null => {
    const started = begin(id, 'pointer')
    if (started === null) return null
    dragOriginX.current = originX
    setDrag(started)
    dragRef.current = started
    try {
      element.setPointerCapture(pointerId)
    } catch {
      /* 캡처 실패는 무시 */
    }
    setAnnouncement(t('chips.dragging', { provider: providerMetaFor(id).title }))
    return started
  }

  /** 포인터 위치로 끌고 있는 칩의 이동량과 목표 인덱스를 갱신한다(시작한 같은 이벤트에서도 부른다). */
  const updateDrag = (current: DragState, clientX: number): void => {
    const list = listRef.current
    // 가장자리에 닿으면 칩 줄을 자동으로 스크롤한다.
    if (list !== null) {
      const bounds = list.getBoundingClientRect()
      if (clientX > bounds.right - EDGE_SCROLL_ZONE_PX) list.scrollLeft += EDGE_SCROLL_STEP_PX
      else if (clientX < bounds.left + EDGE_SCROLL_ZONE_PX) list.scrollLeft -= EDGE_SCROLL_STEP_PX
    }
    const scrollDelta = (list?.scrollLeft ?? 0) - scrollStart.current
    const dx = clientX - dragOriginX.current + scrollDelta
    // 칩 중심은 시작 시점 좌표이므로, 스크롤로 밀린 만큼 끌고 있는 칩의 기준을 맞춘다.
    const targetIndex = nearestIndex(current.centers, current.centers[current.originIndex] + dx)
    const next = { ...current, dx, targetIndex }
    dragRef.current = next
    setDrag(next)
    if (targetIndex !== current.targetIndex) setAnnouncement(t('chips.position', { position: targetIndex + 1 }))
  }

  // 언마운트: 진행 중인 제스처의 window 리스너·타이머·포인터 캡처를 정리한다.
  useEffect(
    () => () => {
      teardown.current?.()
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current)
    },
    [],
  )

  const onPointerDown = (id: UsageProvider) => (event: PointerEvent<HTMLElement>): void => {
    if (event.button !== 0 || !event.isPrimary) return
    teardown.current?.()
    const element = event.currentTarget
    const isMouse = event.pointerType === 'mouse'
    const { pointerId, clientX: startX, clientY: startY } = event
    pending.current = {
      id,
      pointerId,
      startX,
      startY,
      timer: isMouse ? null : window.setTimeout(() => {
        if (pending.current !== null && !pending.current.moved) startPointerDrag(id, element, pointerId, startX)
      }, TOUCH_HOLD_MS),
      moved: false,
      pointerType: event.pointerType,
    }
    const onMove = (moveEvent: globalThis.PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      const current = dragRef.current
      const wait = pending.current
      if (current === null) {
        if (wait === null) return
        // 가로·세로를 모두 본다: 세로로만 움직여도 스크롤 의도이므로 길게 누르기를 취소한다.
        const distance = Math.hypot(moveEvent.clientX - wait.startX, moveEvent.clientY - wait.startY)
        if (isMouse && distance >= MOUSE_DRAG_THRESHOLD_PX) {
          const started = startPointerDrag(id, element, pointerId, wait.startX)
          if (started !== null) updateDrag(started, moveEvent.clientX) // 한 번에 빠르게 끌어도 같은 이벤트로 목표까지 계산한다
        } else if (!isMouse && distance > TOUCH_CANCEL_MOVE_PX) {
          wait.moved = true // 길게 누르기 전에 움직이면 스크롤로 보고 드래그하지 않는다
          if (wait.timer !== null) window.clearTimeout(wait.timer)
        }
        return
      }
      updateDrag(current, moveEvent.clientX)
    }
    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (pending.current?.timer != null) window.clearTimeout(pending.current.timer)
      pending.current = null
      try {
        if (element.hasPointerCapture?.(pointerId) ?? true) element.releasePointerCapture?.(pointerId)
      } catch {
        /* 이미 해제됨 */
      }
      teardown.current = null
    }
    function finish(endEvent: globalThis.PointerEvent): void {
      if (endEvent.pointerId !== pointerId) return
      const current = dragRef.current
      cleanup()
      if (current === null) return
      dragRef.current = null
      suppressClick.current = true // 끈 뒤 따라오는 click이 링크 이동으로 이어지지 않게
      clickTimer.current = window.setTimeout(() => { suppressClick.current = false }, 0)
      if (endEvent.type === 'pointercancel') {
        setDrag(null)
        setAnnouncement(t('chips.dragCancelled'))
      } else commit(current)
    }
    teardown.current = (): void => {
      cleanup()
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  /** Android 길게 누르기 메뉴가 터치 드래그를 가로채지 않게, 터치 누름·드래그 중인 칩에서만 막는다. */
  const onContextMenu = (event: ReactMouseEvent<HTMLElement>): void => {
    if (dragRef.current !== null || (pending.current !== null && pending.current.pointerType !== 'mouse')) event.preventDefault()
  }

  const onKeyDown = (id: UsageProvider) => (event: KeyboardEvent<HTMLElement>): void => {
    const current = dragRef.current
    const title = providerMetaFor(id).title
    if (current === null || current.id !== id) {
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault()
        const started = begin(id, 'keyboard')
        if (started === null) return
        setDrag(started)
        dragRef.current = started
        setAnnouncement(t('chips.grabbed', { provider: title, position: started.originIndex + 1, total: started.ids.length }))
      }
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const targetIndex = stepIndex(current.targetIndex, event.key === 'ArrowLeft' ? -1 : 1, current.ids.length)
      const dx = current.centers[targetIndex] - current.centers[current.originIndex]
      const next = { ...current, targetIndex, dx }
      dragRef.current = next
      setDrag(next)
      setAnnouncement(t('chips.moved', { position: targetIndex + 1, total: current.ids.length }))
    } else if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter') {
      event.preventDefault()
      dragRef.current = null
      commit(current)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      dragRef.current = null
      setDrag(null)
      setAnnouncement(t('chips.cancelled', { provider: title }))
    }
  }

  const onBlur = (): void => {
    const current = dragRef.current
    if (current?.mode === 'keyboard') {
      dragRef.current = null
      setDrag(null)
      setAnnouncement(t('chips.cancelled', { provider: providerMetaFor(current.id).title })) // 포커스를 잃어 취소된 것을 알린다
    }
  }

  const chipDragProps = (id: UsageProvider): ChipDragProps => {
    if (drag === null) return { shift: 0, grabbed: false, onPointerDown: onPointerDown(id), onKeyDown: onKeyDown(id), onBlur, onContextMenu }
    const index = drag.ids.indexOf(id)
    const direction = index === -1 ? 0 : shiftDirection(index, drag.originIndex, drag.targetIndex)
    const shift = id === drag.id ? drag.dx : direction * ((drag.widths[drag.originIndex] ?? 0) + drag.gap)
    return { shift, grabbed: id === drag.id, onPointerDown: onPointerDown(id), onKeyDown: onKeyDown(id), onBlur, onContextMenu }
  }

  return (
    <nav aria-label={t('chips.nav.aria')} className="mt-4" onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } }}>
      <p id="pace-chips-help" className="sr-only">
        {t('chips.help')}
      </p>
      <div className="flex items-center gap-1">
        <ul ref={listRef} className="-my-1 flex min-h-[38px] min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] lg:gap-2">
          {order.map((provider) => (
            <PaceChip key={provider} provider={provider} drag={chipDragProps(provider)} />
          ))}
        </ul>
        <button
          type="button"
          onClick={() => {
            if (customized) onBeforeMove?.() // 패널 FLIP을 먼저 무장한다(드롭과 같은 경로)
            reset()
          }}
          disabled={!customized}
          aria-label={t('chips.reset')}
          title={t('chips.reset')}
          className="motion-button inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent disabled:opacity-40"
        >
          <RotateCcw aria-hidden="true" className="size-3" />
        </button>
        <ViewModeToggle />
      </div>
      <div role="status" aria-live="assertive" className="sr-only">
        {announcement}
      </div>
    </nav>
  )
}
