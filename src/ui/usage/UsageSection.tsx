import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import { providerMetaFor } from '@app/usage/provider-meta'
import { useUsage } from '@app/usage/useUsage'
import { UsageDashboard } from './UsageDashboard'

/**
 * 제공자 한 명의 사용량 섹션 컨테이너(ADR 0.3 D8).
 * app 훅(useUsage)의 상태를 대시보드에 연결하고, 제목·섹션 id·aria-label은 등록부에서 온다.
 * ui는 제공자별 분기를 갖지 않는다.
 */
export function UsageSection({ provider }: { provider: UsageProvider }): ReactNode {
  const meta = providerMetaFor(provider)
  const { state, refresh } = useUsage(provider)
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
      rawRedacted={state.rawRedacted}
    />
  )
}
