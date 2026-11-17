import type { AaTrendResponse } from '../../../shared/trend-contract'
import { buildAaTrendResponse } from '../../domain/trend/metrics/aa'
import type { AaSnapshotRow } from '../../domain/trend/metrics/types'

export interface AaTrendStore {
  readLatestAaDay(): Promise<string | null>
  readAaSnapshot(day: string): Promise<AaSnapshotRow[]>
}

/** 내부 전용(/api/trend/aa): 최신 AA 스냅샷을 읽어 지능·가격·속도·응답시간 상위/하위 10을 만든다. */
export async function getAaTrend(
  store: AaTrendStore,
): Promise<{ ok: true; value: AaTrendResponse } | { ok: false; reason: 'not_ready' }> {
  const day = await store.readLatestAaDay()
  if (day === null) return { ok: false, reason: 'not_ready' }
  const rows = await store.readAaSnapshot(day)
  const value = buildAaTrendResponse(rows)
  if (value === null) return { ok: false, reason: 'not_ready' }
  return { ok: true, value }
}
