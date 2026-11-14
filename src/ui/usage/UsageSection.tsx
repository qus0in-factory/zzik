import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import type { ChartButtonState, UsageHistoryPanelProps } from '@app/usage/history/chart-view'
import { useHistoryDeps } from '@app/usage/history/HistoryDepsContext'
import { useUsageHistoryPanel } from '@app/usage/history/useUsageHistoryPanel'
import { providerMetaFor } from '@app/usage/provider-meta'
import { useUsage } from '@app/usage/useUsage'
import { UsageDashboard } from './UsageDashboard'

/** 차트 패널은 지연 청크다. 닫힌 동안에는 렌더하지 않고 네트워크도 받지 않는다. */
const UsageHistoryPanel = lazy(() => import('@ui/usage/history/lazy-chart'))

export interface UsageSectionProps {
  provider: UsageProvider
  /** 프롭으로 주입하면 훅 대신 그 값을 쓴다(테스트·스토리용). 생략하면 useUsageHistoryPanel(provider)의 결과를 쓴다. */
  chart?: ChartButtonState | null
  chartPanel?: UsageHistoryPanelProps | null
}

/**
 * 제공자 한 명의 사용량 섹션 컨테이너(ADR 0.3 D8).
 * app 훅(useUsage)의 상태를 대시보드에 연결하고, 제목·섹션 id·aria-label은 등록부에서 온다.
 * ui는 제공자별 분기를 갖지 않는다.
 */
export function UsageSection({ provider, chart: chartProp, chartPanel: chartPanelProp }: UsageSectionProps): ReactNode {
  const meta = providerMetaFor(provider)
  const { state, refresh } = useUsage(provider)
  // 배선(ADR 0.7 11절 ③): 이력 훅의 버튼·패널을 대시보드 슬롯에 넣는다. 기능 플래그가 꺼지면 버튼도 그리지 않는다.
  const history = useUsageHistoryPanel(provider)
  const historyEnabled = useHistoryDeps().enabled
  const chart = chartProp !== undefined ? chartProp : historyEnabled ? history.button : null
  const chartPanel = chartPanelProp !== undefined ? chartPanelProp : historyEnabled ? history.panel : null
  const panel: ReactNode = chartPanel === null ? null : (
    <Suspense fallback={<div aria-busy="true" />}>
      <UsageHistoryPanel {...chartPanel} />
    </Suspense>
  )
  return (
    <UsageDashboard
      provider={provider}
      title={meta.title}
      metricsTitle={meta.metricsTitle}
      sectionId={meta.sectionId}
      ariaLabel={meta.ariaLabel}
      refreshHint={meta.refreshHint}
      status={state.status}
      report={state.report}
      errorMessage={state.errorMessage}
      onRetry={() => {
        void refresh()
      }}
      lastSuccessText={state.lastSuccessText}
      staleNoteText={state.staleNoteText}
      collectionNote={state.collectionNote}
      refreshing={state.refreshing}
      collectionStatus={state.collectionStatus}
      chart={chart}
      chartPanel={panel}
    />
  )
}
