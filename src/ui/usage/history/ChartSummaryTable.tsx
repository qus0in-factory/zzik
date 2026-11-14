import type { ReactNode } from 'react'
import type { ChartView } from '@app/usage/history/chart-view'
import { CHART_MESSAGES } from '@app/usage/history/chart-messages'

/** 표 보기(8.4절): 시계열 전체가 아니라 계열별 요약. 숨긴 계열도 포함한다. */
export function ChartSummaryTable({ view }: { view: ChartView }): ReactNode {
  return (
    <details className="chart-table">
      <summary>{CHART_MESSAGES.tableSummary}</summary>
      <table>
        <thead>
          <tr>{CHART_MESSAGES.tableHeaders.map((header) => <th key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody>
          {view.table.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td>{row.current}</td>
              <td>{row.peak}</td>
              <td>{row.low}</td>
              <td>{row.resets}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
