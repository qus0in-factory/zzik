import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type uPlot from 'uplot'
import type { ChartView } from '@app/usage/history/chart-view'
import { CHART_MESSAGES } from '@app/usage/history/chart-messages'
import { ChartA11yTable } from './ChartA11yTable'
import { FALLBACK_PALETTE, toUplotData, toUplotOptions } from './chart-uplot-options'
import type { ChartPalette } from './chart-uplot-options'

/** 색은 전부 CSS 변수에서 읽는다 — 다크모드 값도 같은 이름으로 덮어쓰면 그대로 반영된다. */
function readChartPalette(): ChartPalette {
  if (typeof window === 'undefined') return FALLBACK_PALETTE
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback
  const slots: Record<number, string> = { ...FALLBACK_PALETTE.slots }
  for (let slot = 1; slot <= 8; slot += 1) slots[slot] = read(`--chart-${slot}`, FALLBACK_PALETTE.slots[slot])
  slots[0] = read('--chart-overflow', FALLBACK_PALETTE.slots[0])
  return {
    slots,
    grid: read('--chart-grid', FALLBACK_PALETTE.grid),
    axis: read('--chart-axis', FALLBACK_PALETTE.axis),
    text: read('--chart-text', FALLBACK_PALETTE.text),
  }
}

/** uPlot 캔버스 + 접근성 대체(title/description·숨김 표·range 입력) + 우리 툴팁 하나. */
export function HistoryChart({ view }: { view: ChartView }): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const stops = view.stops
  const maxIndex = stops.length - 1
  const index = selected === null ? maxIndex : Math.min(selected, maxIndex)
  const stop = index >= 0 ? stops[index] : null

  // uPlot 기본 범례 대신 setCursor 훅과 range 입력이 이 툴팁 하나를 갱신한다('시각' + 값).
  const updateTooltip = (idx: number | null): void => {
    const tooltip = tooltipRef.current
    if (tooltip === null) return
    if (idx === null) {
      tooltip.hidden = true
      return
    }
    const point = view.stops[idx]
    if (point === undefined) {
      tooltip.hidden = true
      return
    }
    const rows = point.values
      .filter((value) => value.percent !== null)
      .map((value) => {
        const label = view.series.find((series) => series.id === value.seriesId)?.label ?? value.seriesId
        return `${label} ${value.text}`
      })
    tooltip.textContent = `${CHART_MESSAGES.cursorTime} ${point.label}${rows.length > 0 ? ` · ${rows.join(', ')}` : ` · ${CHART_MESSAGES.valueNone}`}`
    tooltip.hidden = false
  }

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    // 캔버스 2D를 못 쓰는 환경(jsdom 등)은 uPlot을 아예 불러오지 않고 접근성 표로 대체한다.
    if (typeof window === 'undefined' || typeof CanvasRenderingContext2D === 'undefined') return

    let plot: uPlot | null = null
    let cancelled = false
    void import('uplot').then(({ default: UPlot }) => {
      if (cancelled) return
      try {
        plot = new UPlot(toUplotOptions(view, readChartPalette(), updateTooltip), toUplotData(view), host)
        plotRef.current = plot
      } catch {
        plot = null
      }
    })
    return () => {
      cancelled = true
      plot?.destroy()
      plotRef.current = null
      host.replaceChildren()
    }
  }, [view])

  const hideTooltip = (): void => {
    if (tooltipRef.current !== null) tooltipRef.current.hidden = true
  }

  // N1: range 입력을 uPlot 십자선(setCursor)과 묶는다. 키보드로 시점을 옮여도 십자선·툴팁이 따라온다.
  const onRangeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(event.target.value)
    setSelected(next)
    updateTooltip(next)
    const plot = plotRef.current
    const t = view.stops[next]?.t
    if (plot !== null && t !== undefined) plot.setCursor({ left: plot.valToPos(t / 1000, 'x'), top: 0 }, true)
  }

  return (
    <div className="chart-frame" onPointerLeave={hideTooltip}>
      <div className="chart-canvas-host" ref={hostRef} aria-hidden="true" />
      <div className="chart-tooltip" ref={tooltipRef} role="status" hidden />
      <div className="chart-a11y">
        <p>{view.title}</p>
        <p>{view.description}</p>
        <ChartA11yTable view={view} />
      </div>
      {stops.length > 0 && (
        <input
          className="chart-range-input"
          type="range"
          min={0}
          max={maxIndex}
          step={1}
          value={index}
          aria-label={CHART_MESSAGES.rangeInputLabel}
          aria-valuetext={stop?.valueText ?? CHART_MESSAGES.valueNone}
          onChange={onRangeChange}
        />
      )}
    </div>
  )
}
