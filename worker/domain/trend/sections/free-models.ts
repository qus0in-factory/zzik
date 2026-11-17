/**
 * `free-models` 섹션: 호스팅 무료(Zen·OpenRouter) + 로컬 실행 가능(models.dev ollama-cloud).
 * 순수 함수. 출처별 items를 따로 보관해 한 출처가 실패해도 다른 출처 항목을 지우지 않는다.
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_FREE_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
} from '../../../../shared/trend-contract'
import type { TrendFreeKind, TrendItem, TrendPrice, TrendSectionPayload } from '../../../../shared/trend-contract'
import { parseRelease } from '../sources'
import type { TrendModelRecord } from '../sources'

const MAX_ITEMS = 50
const DEPRECATED = new Set(['deprecated', 'retired'])

/** 저장 전용: 출처별 마지막 성공 items. 공개 응답에서는 projection이 제거한다. */
export interface FreeModelsPayload extends TrendSectionPayload {
  sourceItems: Record<string, TrendItem[]>
}

export interface FreeModelsSourceData {
  id: string
  kind: TrendFreeKind
  status: 'ok' | 'stale'
  fetchedAt: string
  /** 200 응답이면 정규화 레코드, 304·실패면 null이면 carried를 재사용한다. */
  records: readonly TrendModelRecord[] | null
  carried: readonly TrendItem[]
}

function pickRelease(group: readonly TrendModelRecord[]): Pick<TrendItem, 'releaseDate' | 'precision'> {
  const day = group
    .filter((record) => record.releasePrecision === 'day' && record.releaseMs !== null)
    .sort((a, b) => (b.releaseMs ?? 0) - (a.releaseMs ?? 0))[0]
  if (day !== undefined) return { releaseDate: day.releaseDate, precision: 'day' }
  const month = group.find((record) => record.releasePrecision === 'month')
  if (month !== undefined) return { releaseDate: month.releaseDate, precision: 'month' }
  return { releaseDate: null, precision: 'unknown' }
}

function representative(group: readonly TrendModelRecord[]): TrendModelRecord {
  return group.find((record) => record.price !== null) ?? group[0]!
}

function inWindow(releaseMs: number | null, nowMs: number): boolean {
  if (releaseMs === null) return false
  return releaseMs >= nowMs - TREND_FREE_MODELS_WINDOW_MS && releaseMs <= nowMs
}

function recordEligible(record: TrendModelRecord, kind: TrendFreeKind, nowMs: number): boolean {
  if (record.status !== null && DEPRECATED.has(record.status)) return false
  if (record.expiresAtMs !== undefined && record.expiresAtMs !== null && record.expiresAtMs < nowMs) return false
  if (!inWindow(record.releaseMs, nowMs)) return false
  if (kind === 'hosted') return record.free
  return record.provider === 'ollama-cloud' && record.openWeights
}

function itemFromGroup(group: readonly TrendModelRecord[], kind: TrendFreeKind, nowMs: number): TrendItem {
  const chosen = representative(group)
  const release = pickRelease(group)
  const providers = [...new Set(group.map((record) => record.provider))].sort()
  const releaseMs = group.reduce((max, record) => Math.max(max, record.releaseMs ?? 0), 0)
  const expiry = group.reduce<number | null>((min, record) => {
    if (record.expiresAtMs === undefined || record.expiresAtMs === null) return min
    return min === null ? record.expiresAtMs : Math.min(min, record.expiresAtMs)
  }, null)
  const price: TrendPrice | null = kind === 'hosted' ? (chosen.price ?? { input: 0, output: 0 }) : null
  return {
    id: chosen.canonicalId,
    name: chosen.name,
    creator: chosen.creator,
    releaseDate: release.releaseDate,
    precision: release.precision,
    price,
    free: kind === 'hosted',
    openWeights: group.some((record) => record.openWeights),
    providers,
    links: {},
    extra: expiry === null ? { releaseMs } : { releaseMs, expiresAtMs: expiry },
    freeKind: kind,
  }
}

/** 최근 30일 창·만료·deprecated를 적용해 canonical id 기준으로 묶는다. */
export function filterFreeRecords(records: readonly TrendModelRecord[], kind: TrendFreeKind, nowMs: number): TrendItem[] {
  const groups = new Map<string, TrendModelRecord[]>()
  for (const record of records) {
    if (!recordEligible(record, kind, nowMs)) continue
    const group = groups.get(record.canonicalId)
    if (group === undefined) groups.set(record.canonicalId, [record])
    else group.push(record)
  }
  return [...groups.values()].map((group) => itemFromGroup(group, kind, nowMs))
}

function releaseMsOf(item: TrendItem): number | null {
  const stored = item.extra?.releaseMs
  if (typeof stored === 'number') return stored
  if (item.releaseDate === null) return null
  return parseRelease(item.releaseDate).ms
}

/** 304·실패 시 보관한 items에 현재 시각 기준 창/만료를 다시 적용한다. */
export function reevaluateFreeItems(items: readonly TrendItem[], kind: TrendFreeKind, nowMs: number): TrendItem[] {
  return items.filter((item) => {
    if (item.freeKind !== kind) return false
    if (!inWindow(releaseMsOf(item), nowMs)) return false
    const expiresAtMs = item.extra?.expiresAtMs
    return !(typeof expiresAtMs === 'number' && expiresAtMs < nowMs)
  })
}

function mergeById(items: readonly TrendItem[]): TrendItem[] {
  const merged = new Map<string, TrendItem>()
  for (const item of items) {
    const existing = merged.get(item.id)
    if (existing === undefined) {
      merged.set(item.id, { ...item, providers: [...item.providers] })
      continue
    }
    merged.set(item.id, {
      ...existing,
      providers: [...new Set([...existing.providers, ...item.providers])].sort(),
      openWeights: existing.openWeights || item.openWeights,
    })
  }
  return [...merged.values()]
}

function sortByRelease(items: TrendItem[]): TrendItem[] {
  return items.sort((a, b) => {
    const aMs = releaseMsOf(a) ?? 0
    const bMs = releaseMsOf(b) ?? 0
    return bMs - aMs || a.name.localeCompare(b.name)
  })
}

export function buildFreeModels(sources: readonly FreeModelsSourceData[], nowMs: number): FreeModelsPayload {
  const perSource: Record<string, TrendItem[]> = {}
  for (const source of sources) {
    perSource[source.id] = source.records === null
      ? reevaluateFreeItems(source.carried, source.kind, nowMs)
      : filterFreeRecords(source.records, source.kind, nowMs)
  }

  const hosted = mergeById(sources.filter((source) => source.kind === 'hosted').flatMap((source) => perSource[source.id] ?? []))
  const local = mergeById(sources.filter((source) => source.kind === 'local').flatMap((source) => perSource[source.id] ?? []))

  // 호스팅 무료가 우선한다. 같은 canonical id의 로컬 실행 정보는 provider로 합친다.
  const localOnly: TrendItem[] = []
  const hostedById = new Map(hosted.map((item) => [item.id, item]))
  for (const item of local) {
    const hostedItem = hostedById.get(item.id)
    if (hostedItem === undefined) {
      localOnly.push(item)
      continue
    }
    hostedById.set(item.id, {
      ...hostedItem,
      providers: [...new Set([...hostedItem.providers, 'ollama-cloud'])].sort(),
      openWeights: true,
    })
  }

  const items = [
    ...sortByRelease([...hostedById.values()]),
    ...sortByRelease(localOnly),
  ].slice(0, MAX_ITEMS)

  const generatedAt = new Date(nowMs).toISOString()
  return {
    section: 'free-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt,
    rule: TREND_FREE_MODELS_RULE,
    sources: sources.map((source) => ({ id: source.id, fetchedAt: source.fetchedAt, status: source.status })),
    items,
    sourceItems: perSource,
  }
}
