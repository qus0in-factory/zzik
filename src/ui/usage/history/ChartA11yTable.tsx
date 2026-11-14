import type { ReactNode } from 'react'
import type { ChartView } from '@app/usage/history/chart-view'
import { CHART_MESSAGES } from '@app/usage/history/chart-messages'

/** 캔버스 옆의 접근성용 데이터 표(시각적으로는 숨긴다). 시점마다 보이는 계열의 값을 싣는다. */
export function ChartA11yTable({ view }: { view: ChartView }): ReactNode {
  const visible = view.series.filter((series) => !series.hidden)
  return (
    <table className="chart-a11y-table">
      <caption>{view.title}</caption>
      <thead>
        <tr>
          <th scope="col">시점</th>
          {visible.map((series) => <th key={series.id} scope="col">{series.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {view.stops.map((stop) => (
          <tr key={stop.t}>
            <th scope="row">{stop.label}</th>
            {visible.map((series) => {
              const value = stop.values.find((item) => item.seriesId === series.id)
              return <td key={series.id}>{value?.text ?? CHART_MESSAGES.gapText}</td>
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
