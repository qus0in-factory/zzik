/**
 * 공개 응답 투영. D1 payload에 섞일 수 있는 정규화 메타데이터(`extra`)나 알 수 없는
 * 필드를 제거하고 계약 필드만 내보낸다. 저장 payload는 그대로 둔다.
 */
import { TREND_SECTIONS } from '../../../shared/trend-contract'
import type { TrendItem, TrendPrice, TrendSection, TrendSectionPayload, TrendSourceState } from '../../../shared/trend-contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPrecision = (value: unknown): value is TrendItem['precision'] => value === 'day' || value === 'month' || value === 'unknown'
const isStatus = (value: unknown): value is TrendSourceState['status'] => value === 'ok' || value === 'stale'

/** @returns 유효하면 가격, 없으면 null, 구조가 잘못됐으면 undefined */
function projectPrice(value: unknown): TrendPrice | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const { input, output } = value
  if (typeof input !== 'number' || typeof output !== 'number') return undefined
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return undefined
  return { input, output }
}

function projectLinks(value: unknown): TrendItem['links'] | null {
  if (value === null || value === undefined) return {}
  if (!isRecord(value)) return null
  const links: TrendItem['links'] = {}
  if (typeof value.modelsDev === 'string') links.modelsDev = value.modelsDev
  if (typeof value.openrouter === 'string') links.openrouter = value.openrouter
  if (typeof value.opencode === 'string') links.opencode = value.opencode
  return links
}

function projectItem(value: unknown): TrendItem | null {
  if (!isRecord(value)) return null
  const { id, name, creator, releaseDate, precision, free, openWeights, providers } = value
  if (typeof id !== 'string' || id === '' || typeof name !== 'string' || typeof creator !== 'string') return null
  if (releaseDate !== null && typeof releaseDate !== 'string') return null
  if (!isPrecision(precision) || typeof free !== 'boolean' || typeof openWeights !== 'boolean') return null
  if (!Array.isArray(providers) || !providers.every((provider) => typeof provider === 'string')) return null
  const price = projectPrice(value.price)
  if (price === undefined) return null
  const links = projectLinks(value.links)
  if (links === null) return null
  return { id, name, creator, releaseDate, precision, price, free, openWeights, providers: [...providers], links }
}

function projectSources(value: unknown): TrendSourceState[] | null {
  if (!Array.isArray(value)) return null
  const sources: TrendSourceState[] = []
  for (const source of value) {
    if (!isRecord(source)) return null
    const { id, fetchedAt, status } = source
    if (typeof id !== 'string' || id === '' || typeof fetchedAt !== 'string' || !isStatus(status)) return null
    sources.push({ id, fetchedAt, status })
  }
  return sources
}

/** 계약을 만족하지 않으면 null(호출자가 500으로 변환). */
export function projectSectionPayload(value: unknown, expected: TrendSection): TrendSectionPayload | null {
  if (!isRecord(value)) return null
  const { section, schemaVersion, generatedAt, rule, sources, items } = value
  if (typeof section !== 'string' || !(TREND_SECTIONS as readonly string[]).includes(section) || section !== expected) return null
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion <= 0) return null
  if (typeof generatedAt !== 'string' || typeof rule !== 'string' || !Array.isArray(items)) return null
  const projectedSources = projectSources(sources)
  if (projectedSources === null) return null
  const projectedItems: TrendItem[] = []
  for (const item of items) {
    const projected = projectItem(item)
    if (projected === null) return null
    projectedItems.push(projected)
  }
  return {
    section: section as TrendSection,
    schemaVersion,
    generatedAt,
    rule,
    sources: projectedSources,
    items: projectedItems,
  }
}
