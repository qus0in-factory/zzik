import type { ReactNode } from 'react'
import type { ChartView } from '@app/usage/history/chart-view'
import { CHART_MESSAGES } from '@app/usage/history/chart-messages'

/** 범례(8.4절). aria-pressed = 표시. 숨김은 속 빈 선 조각 + muted 글자. */
export function ChartLegend({ view, onToggle, onShowAll }: { view: ChartView; onToggle(id: string): void; onShowAll(): void }): ReactNode {
  const hiddenCount = view.series.filter((s) => s.hidden && s.slot > 0).length
  return (
    <div className="chart-legend">
      {view.series.map((series) => (
        <button
          key={series.id}
          type="button"
          className={`chart-legend-item${series.hidden ? ' is-hidden' : ''}`}
          aria-pressed={!series.hidden}
          data-hidden={series.hidden ? 'true' : undefined}
          onClick={() => onToggle(series.id)}
        >
          <svg className="chart-swatch" width="20" height="8" aria-hidden="true">
            <line className="chart-swatch-line" data-slot={series.slot} x1="0" y1="4" x2="20" y2="4" strokeDasharray={series.dash ?? undefined} />
          </svg>
          <span>{series.label}</span>
        </button>
      ))}
      {hiddenCount > 0 && view.empty !== 'all_hidden' && (
        <button type="button" className="chart-show-all" onClick={onShowAll}>{CHART_MESSAGES.showAll}</button>
      )}
    </div>
  )
}
