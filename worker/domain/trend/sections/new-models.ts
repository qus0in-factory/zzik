/** `new-models` 섹션: 최근 7일 출시 또는 이 대시보드에서 처음 본 모델. 순수 함수. */
import {
  TREND_NEW_MODELS_RELEASE_MAX_MS,
  TREND_NEW_MODELS_RULE,
  TREND_NEW_MODELS_WINDOW_MS,
  TREND_SCHEMA_VERSION,
  TREND_SOURCE_MODELS_DEV,
} from '../../../../shared/trend-contract'
import type { TrendItem, TrendPrice, TrendSectionPayload } from '../../../../shared/trend-contract'
import type { TrendModelRecord } from '../sources'

const MAX_ITEMS = 50
const DEPRECATED = new Set(['deprecated', 'retired'])

function pickRelease(group: readonly TrendModelRecord[]): Pick<TrendItem, 'releaseDate' | 'precision'> {
  const day = group.filter((record) => record.releasePrecision === 'day' && record.releaseMs !== null).sort((a, b) => (b.releaseMs ?? 0) - (a.releaseMs ?? 0))[0]
  if (day !== undefined) return { releaseDate: day.releaseDate, precision: 'day' }
  const month = group.find((record) => record.releasePrecision === 'month')
  if (month !== undefined) return { releaseDate: month.releaseDate, precision: 'month' }
  return { releaseDate: null, precision: 'unknown' }
}

function representative(group: readonly TrendModelRecord[]): TrendModelRecord {
  return group.find((record) => record.price !== null) ?? group[0]!
}

function priceOf(record: TrendModelRecord): TrendPrice | null {
  return record.price
}

/** @param seen canonical id → first_seen epoch ms. 새 모델은 now로 간주한다. */
export function buildNewModels(records: readonly TrendModelRecord[], seen: ReadonlyMap<string, number>, nowMs: number): TrendSectionPayload {
  const windowStart = nowMs - TREND_NEW_MODELS_WINDOW_MS
  const releaseMaxStart = nowMs - TREND_NEW_MODELS_RELEASE_MAX_MS
  const groups = new Map<string, TrendModelRecord[]>()
  for (const record of records) {
    if (record.status !== null && DEPRECATED.has(record.status)) continue
    const firstSeen = seen.get(record.canonicalId) ?? nowMs
    const releaseRecent = record.releasePrecision === 'day' && record.releaseMs !== null && record.releaseMs >= windowStart && record.releaseMs <= nowMs
    const firstSeenRecent = firstSeen >= windowStart && firstSeen <= nowMs
    const releaseWithin30 = record.releaseMs !== null && record.releaseMs >= releaseMaxStart && record.releaseMs <= nowMs
    if (!releaseRecent && !(firstSeenRecent && releaseWithin30)) continue
    const group = groups.get(record.canonicalId)
    if (group === undefined) groups.set(record.canonicalId, [record])
    else group.push(record)
  }

  const items: Array<TrendItem & { sortMs: number }> = []
  for (const [id, group] of groups) {
    const chosen = representative(group)
    const release = pickRelease(group)
    const providers = [...new Set(group.map((record) => record.provider))].sort()
    const price = priceOf(chosen)
    const sortMs = group.reduce((max, record) => Math.max(max, record.releaseMs ?? 0), 0)
    items.push({
      id,
      name: chosen.name,
      creator: chosen.creator,
      releaseDate: release.releaseDate,
      precision: release.precision,
      price,
      free: price !== null && price.input === 0 && price.output === 0,
      openWeights: group.some((record) => record.openWeights),
      providers,
      links: {},
      extra: { providers: providers.length },
      sortMs,
    })
  }
  items.sort((a, b) => b.sortMs - a.sortMs || a.name.localeCompare(b.name))
  const limited = items.slice(0, MAX_ITEMS).map(({ sortMs: _sortMs, ...item }) => item)
  const generated= new Date(nowMs).toISOString()
  return {
    section: 'new-models',
    schemaVersion: TREND_SCHEMA_VERSION,
    generatedAt: generated,
    rule: TREND_NEW_MODELS_RULE,
    sources: [{ id: TREND_SOURCE_MODELS_DEV, fetchedAt: generated, status: 'ok' }],
    items: limited,
  }
}
