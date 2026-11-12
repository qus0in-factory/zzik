import { useEffect, useState } from 'react'
import { useCardActivityStore, useUsageDeps } from './UsageGatewayContext'
import { activeLap } from './activity'

/** Only client observation history is retained here; server values stay in Query.
 * 기록은 Provider가 소유한 카드 id별 스토어에 두어 재마운트 후에도 달리기를 이어 간다.
 */
export function useCardActivity(id: string, usedPercent: number | null): number | null {
  const deps = useUsageDeps()
  const store = useCardActivityStore()
  const [lap, setLap] = useState<number | null>(null)
  useEffect(() => {
    const now = Date.parse(deps.clock.nowIso())
    const observation = store.observe(id, usedPercent, now)
    setLap(activeLap(observation, now))
    if (observation.expiresAt > now) {
      return deps.scheduler.schedule(observation.expiresAt - now, () => setLap(null))
    }
  }, [id, usedPercent, deps, store])
  return lap
}
