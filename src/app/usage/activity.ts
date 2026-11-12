import { usageActivity } from '@domain/usage/activity'

export interface ActivityObservation {
  previous: number | null
  lapSeconds: number | null
  expiresAt: number
}
export function observeActivity(prior: ActivityObservation | undefined, current: number | null, now: number): ActivityObservation {
  const change = usageActivity(prior?.previous ?? null, current)
  if (change) return { previous: current, lapSeconds: change.lapSeconds, expiresAt: now + 300_000 }
  return { previous: current, lapSeconds: current === null ? null : prior?.lapSeconds ?? null, expiresAt: prior?.expiresAt ?? 0 }
}
export function activeLap(observation: ActivityObservation, now: number): number | null {
  return now < observation.expiresAt ? observation.lapSeconds : null
}
