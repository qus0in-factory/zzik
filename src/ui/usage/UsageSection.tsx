import type { ReactNode } from 'react'
import { useUsage } from '@app/usage/useUsage'
import { UsageDashboard } from './UsageDashboard'

/** 사용량 섹션 컨테이너: app 훅(useUsage)의 상태를 대시보드에 연결한다(ADR 0.2 D11). */
export function UsageSection(): ReactNode {
  const { state, refresh } = useUsage()
  return (
    <UsageDashboard
      status={state.status}
      report={state.report}
      errorMessage={state.errorMessage}
      onRetry={() => {
        void refresh()
      }}
      lastSuccessText={state.lastSuccessText}
      staleNoteText={state.staleNoteText}
    />
  )
}
