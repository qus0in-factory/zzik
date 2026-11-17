import type { TrendPlanGroup, TrendSection, TrendSectionPayload, TrendSourceState } from '../../../shared/trend-contract'
import { buildPlanModels } from '../../domain/trend/plan/build'
import type {
  PlanObservationRow,
  PlanSectionPayload,
  PlanSource,
  PlanStore,
} from '../../domain/trend/plan/types'
import type { TrendModelRecord } from '../../domain/trend/sources'
import { writeSectionChecked } from './refresh-trend'

export interface PlanRefreshResult {
  ok: boolean
  written: boolean
  groups: number
  sources: Record<string, 'ok' | 'stale'>
}

function parsePayload(text: string): PlanSectionPayload | null {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const payload = value as PlanSectionPayload
    if (payload.section !== 'plan-models' || !Array.isArray(payload.items) || !Array.isArray(payload.sources) || !Array.isArray(payload.plans)) return null
    return payload
  } catch {
    return null
  }
}

function sameContent(previous: PlanSectionPayload, next: PlanSectionPayload): boolean {
  return previous.schemaVersion === next.schemaVersion &&
    previous.rule === next.rule &&
    JSON.stringify(previous.plans) === JSON.stringify(next.plans) &&
    JSON.stringify(previous.sources.map((source) => [source.id, source.status])) === JSON.stringify(next.sources.map((source) => [source.id, source.status]))
}

interface Fetched {
  source: PlanSource
  observations: readonly PlanObservationRow[] | null
  failed: boolean
}

/**
 * 공개 요금제 출처(Go/Ollama)를 읽어 trend_plan_observation에 관측을 남기고 plan-models를 갱신한다.
 * 출처 실패는 기존 관측을 지우지 않으며, 실패한 그룹만 partial/unavailable로 낮춘다.
 */
export async function refreshPlanModels(input: {
  store: PlanStore
  sources: readonly PlanSource[]
  catalog?: readonly TrendModelRecord[] | null
  nowMs: number
}): Promise<PlanRefreshResult> {
  const { store, sources, nowMs } = input
  const fetched = await Promise.all(sources.map(async (source): Promise<Fetched> => {
    try {
      const result = await source.fetch(nowMs)
      if (!result.ok) return { source, observations: null, failed: true }
      try {
        await store.upsertObservations(source.plan, source.id, result.observations, nowMs)
        return { source, observations: null, failed: false }
      } catch {
        return { source, observations: null, failed: true }
      }
    } catch {
      return { source, observations: null, failed: true }
    }
  }))

  const statuses: Record<string, 'ok' | 'stale'> = {}
  for (const entry of fetched) statuses[entry.source.id] = entry.failed ? 'stale' : 'ok'

  const row = await store.readSection('plan-models')
  const previous = row === null ? null : parsePayload(row.payload)
  const observations = await store.readObservations()
  const nowIso = new Date(nowMs).toISOString()
  const sourceStates: TrendSourceState[] = sources.map((source) => ({
    id: source.id,
    fetchedAt: statuses[source.id] === 'ok'
      ? nowIso
      : previous?.sources.find((state) => state.id === source.id)?.fetchedAt ?? nowIso,
    status: statuses[source.id] ?? 'stale',
  }))

  const anyData = observations.length > 0 || sources.some((source) => statuses[source.id] === 'ok')
  if (!anyData && previous === null) {
    return { ok: false, written: false, groups: 0, sources: statuses }
  }

  let payload: PlanSectionPayload
  if (observations.length === 0 && previous !== null) {
    // 관측 테이블이 비어 있으면 직전 공개 내용을 유지하고 출처 상태만 갱신한다.
    payload = { ...previous, generatedAt: nowIso, sources: sourceStates, plans: previous.plans as TrendPlanGroup[] }
  } else {
    payload = buildPlanModels({
      observations,
      catalog: input.catalog ?? null,
      sources: sourceStates,
      previous,
      nowMs,
    })
  }

  const unchanged = previous !== null && sameContent(previous, payload)
  if (!unchanged) await store.writeSection(payload as TrendSectionPayload)
  await writeSectionChecked(store, 'plan-models', nowMs)
  return {
    ok: !Object.values(statuses).includes('stale'),
    written: !unchanged,
    groups: payload.plans.length,
    sources: statuses,
  }
}

export type { TrendSection }
