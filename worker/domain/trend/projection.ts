/**
 * 공개 응답 투영. D1 payload에 섞일 수 있는 정규화 메타데이터(`extra`)나 알 수 없는
 * 필드를 제거하고 계약 필드만 내보낸다. 저장 payload는 그대로 둔다.
 */
import { TREND_SECTIONS } from '../../../shared/trend-contract'
import type {
  TrendItem, TrendMetricsBlock, TrendMetricsEntry, TrendMetricsNote, TrendPrice,
  TrendSection, TrendSectionPayload, TrendSourceState,
} from '../../../shared/trend-contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isPrecision = (value: unknown): value is TrendItem['precision'] => value === 'day' || value === 'month' || value === 'unknown'
const isStatus = (value: unknown): value is TrendSourceState['status'] => value === 'ok' || value === 'stale'
const isFreeKind = (value: unknown): value is TrendItem['freeKind'] => value === 'hosted' || value === 'local'
const isBlockStatus = (value: unknown): value is TrendMetricsBlock['status'] => value === 'ok' || value === 'stale' || value === 'not_configured'
const isMetricsKind = (value: unknown): value is TrendMetricsEntry['kind'] => value === 'new-top' || value === 'moved' || value === 'steady'
const isMetricsNote = (value: unknown): value is TrendMetricsNote => value === 'baseline' || value === 'version_changed' || value === 'source_failed'

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
  const freeKind = value.freeKind
  if (freeKind !== undefined && !isFreeKind(freeKind)) return null
  return {
    id, name, creator, releaseDate, precision, price, free, openWeights, providers: [...providers], links,
    ...(freeKind === undefined ? {} : { freeKind }),
  }
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

function projectMetricsEntry(value: unknown): TrendMetricsEntry | null {
  if (!isRecord(value)) return null
  const { id, name, creator, rank, rankDelta, kind } = value
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  if (creator !== null && typeof creator !== 'string') return null
  if (typeof rank !== 'number' || !Number.isInteger(rank) || rank <= 0) return null
  if (rankDelta !== null && (typeof rankDelta !== 'number' || !Number.isFinite(rankDelta))) return null
  if (!isMetricsKind(kind)) return null
  const entry: TrendMetricsEntry = { id, name, creator, rank, rankDelta, kind }
  if (value.index !== undefined) {
    if (typeof value.index !== 'number' || !Number.isFinite(value.index)) return null
    entry.index = value.index
  }
  if (value.share7d !== undefined) {
    if (typeof value.share7d !== 'number' || !Number.isFinite(value.share7d) || value.share7d < 0 || value.share7d > 1) return null
    entry.share7d = value.share7d
  }
  if (value.shareDelta !== undefined) {
    if (typeof value.shareDelta !== 'number' || !Number.isFinite(value.shareDelta)) return null
    entry.shareDelta = value.shareDelta
  }
  return entry
}

function projectMetricsBlock(value: unknown): TrendMetricsBlock | null {
  if (!isRecord(value)) return null
  const { id, status, asOf, entries, attribution } = value
  if (id !== 'aa-intelligence' && id !== 'or-usage') return null
  if (!isBlockStatus(status) || typeof asOf !== 'string' || typeof attribution !== 'string' || !Array.isArray(entries)) return null
  const block: TrendMetricsBlock = { id, status, asOf, entries: [], attribution }
  if (value.version !== undefined) {
    if (typeof value.version !== 'string') return null
    block.version = value.version
  }
  if (value.note !== undefined) {
    if (!isMetricsNote(value.note)) return null
    block.note = value.note
  }
  for (const entry of entries) {
    const projected = projectMetricsEntry(entry)
    if (projected === null) return null
    block.entries.push(projected)
  }
  return block
}

function projectMetricsBlocks(value: unknown): TrendMetricsBlock[] | null {
  if (!Array.isArray(value)) return null
  const blocks: TrendMetricsBlock[] = []
  for (const block of value) {
    const projected = projectMetricsBlock(block)
    if (projected === null) return null
    blocks.push(projected)
  }
  return blocks
}

/** 계약을 만족하지 않으면 null(호출자가 500으로 변환). */
export function projectSectionPayload(value: unknown, expected: TrendSection): TrendSectionPayload | null {
  if (!isRecord(value)) return null
  const { section, schemaVersion, generatedAt, rule, sources, items, blocks } = value
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
  const projectedBlocks = blocks === undefined ? undefined : projectMetricsBlocks(blocks)
  if (projectedBlocks === null) return null
  return {
    section: section as TrendSection,
    schemaVersion,
    generatedAt,
    rule,
    sources: projectedSources,
    items: projectedItems,
    ...(projectedBlocks === undefined ? {} : { blocks: projectedBlocks }),
  }
}
