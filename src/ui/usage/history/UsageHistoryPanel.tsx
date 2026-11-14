import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { UsageHistoryPanelProps } from '@app/usage/history/chart-view'
import { CHART_MESSAGES } from '@app/usage/history/chart-messages'
import { ChartLegend } from './ChartLegend'
import { ChartRangeTabs } from './ChartRangeTabs'
import { ChartSummaryTable } from './ChartSummaryTable'
import { HistoryChart } from './HistoryChart'
import './chart.css'

/** 프롭만 받아 그리는 이력 패널(지연 청크의 진입점). 상태·판정·문구는 app이 만든다. */
export function UsageHistoryPanel({ panelId, regionLabel, range, state, actions }: UsageHistoryPanelProps): ReactNode {
  const frameRef = useRef<HTMLDivElement>(null)
  const lastSize = useRef('')

  // 크기 측정 → 150ms 디바운스로 app에 알린다(조립 루트가 그 크기로 ChartView를 다시 만든다).
  useEffect(() => {
    const element = frameRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const notify = (): void => {
      const width = Math.round(element.getBoundingClientRect().width)
      const height = width < 640 ? 200 : 240
      const key = `${width}x${height}`
      if (key === lastSize.current) return
      lastSize.current = key
      actions.onResize({ width, height })
    }
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(notify, 150)
    })
    observer.observe(element)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      observer.disconnect()
    }
  }, [actions])

  return (
    <section id={panelId} role="region" aria-label={regionLabel} className="usage-history-chart usage-history-panel fade-in">
      <div className="chart-toolbar" ref={frameRef}>
        <ChartRangeTabs range={range} onSelect={actions.onSelectRange} />
      </div>

      {state.phase === 'loading' && (
        <div className="chart-skeleton" data-slot="skeleton" aria-busy="true">{CHART_MESSAGES.loading}</div>
      )}
      {state.phase === 'error' && (
        <div className="chart-error" role="alert">
          <span>{state.message}</span>
          <button type="button" className="chart-retry" onClick={actions.onRetry}>{CHART_MESSAGES.retry}</button>
        </div>
      )}
      {state.phase === 'ready' && (
        <>
          {state.syncing && <span className="chart-syncing" aria-live="polite">{CHART_MESSAGES.syncing}</span>}
          {state.progress !== null && <span className="chart-progress" aria-live="polite">{state.progress}</span>}
          {state.note !== null && <span className="chart-note">{state.note}</span>}
          {state.view.empty === 'no_points' && <p className="chart-empty">{CHART_MESSAGES.emptyNoPoints}</p>}
          {state.view.empty === 'all_hidden' && (
            <p className="chart-empty">
              {CHART_MESSAGES.emptyAllHidden}{' '}
              <button type="button" className="chart-show-all" onClick={actions.onShowAllSeries}>{CHART_MESSAGES.showAll}</button>
            </p>
          )}
          <HistoryChart view={state.view} />
          <ChartLegend view={state.view} onToggle={actions.onToggleSeries} onShowAll={actions.onShowAllSeries} />
          <ChartSummaryTable view={state.view} />
        </>
      )}
    </section>
  )
}

export default UsageHistoryPanel
