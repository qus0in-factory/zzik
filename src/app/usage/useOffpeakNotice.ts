import type { UsageProvider } from '@domain/usage/providers'
import { offpeakNoticeOf } from './offpeak-notice'
import type { OffpeakNotice } from './offpeak-notice'
import { useUsageDeps } from './UsageGatewayContext'

/** useUsage의 nowIso 틱을 재사용하며 자체 타이머를 만들지 않는다. */
export function useOffpeakNotice(provider: UsageProvider, nowIso: string | null): OffpeakNotice | null {
  const deps = useUsageDeps()
  return offpeakNoticeOf(provider, deps.offpeak ?? {}, new Date(nowIso ?? deps.clock.nowIso()))
}
