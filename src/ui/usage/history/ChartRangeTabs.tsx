import type { ReactNode } from 'react'
import type { ChartRange } from '@domain/usage/history/types'
import { CHART_MESSAGES, CHART_RANGE_TEXT } from '@app/usage/history/chart-messages'

const RANGES: readonly ChartRange[] = ['24h', '7d', '30d']

/** 범위 탭(8.2절). view 밖의 range를 받으므로 로딩·오류 단계에도 그린다. */
export function ChartRangeTabs({ range, onSelect }: { range: ChartRange; onSelect(range: ChartRange): void }): ReactNode {
  return (
    <div className="chart-range-tabs" role="group" aria-label={CHART_MESSAGES.rangeGroupLabel}>
      {RANGES.map((item) => (
        <button key={item} type="button" className="chart-range-tab" aria-pressed={item === range} onClick={() => onSelect(item)}>
          {CHART_RANGE_TEXT[item]}
        </button>
      ))}
    </div>
  )
}
