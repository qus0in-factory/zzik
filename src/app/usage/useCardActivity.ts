import { useEffect, useRef, useState } from 'react'
import { useUsageDeps } from './UsageGatewayContext'
import { activeLap, observeActivity } from './activity'
import type { ActivityObservation } from './activity'

/** Only client observation history is retained here; server values stay in Query. */
export function useCardActivity(id: string, usedPercent: number | null): number | null {
  const deps = useUsageDeps()
  const history = useRef<{ id: string; observation: ActivityObservation } | null>(null)
  const [lap, setLap] = useState<number | null>(null)
  useEffect(() => {
    const now = Date.parse(deps.clock.nowIso())
    const prior = history.current?.id === id ? history.current.observation : undefined
    const observation = observeActivity(prior, usedPercent, now)
    history.current = { id, observation }
    setLap(activeLap(observation, now))
    if (observation.expiresAt > now) {
      return deps.scheduler.schedule(observation.expiresAt - now, () => setLap(null))
    }
  }, [id, usedPercent, deps])
  return lap
}
