/** Artificial Analysis·OpenRouter 응답의 순수 디코더. I/O·시간 없음. */
import { TREND_OR_MAX_ROWS, TREND_OR_MAX_ROWS_PER_DAY } from '../../../../shared/trend-contract'
import { isRecord } from '../../../../shared/d1-canonical'
import type { AaModelEntry } from './types'
import type { OrRankingRow } from './types'

export type DecodeFailure = { ok: false; reason: 'invalid' }

export interface DecodedAaPage {
  ok: true
  version: string
  entries: AaModelEntry[]
  hasMore: boolean
  page: number
  totalPages: number | null
}

const DOMAIN_KEYS = [
  'finance_and_accounting',
  'strategy_and_ops',
  'legal',
  'healthcare_and_medical',
  'engineering',
  'economics',
] as const

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function decodeAaEntry(raw: Record<string, unknown>): AaModelEntry | null {
  const slug = typeof raw.slug === 'string' && raw.slug !== '' ? raw.slug : typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
  if (slug === '') return null
  const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : slug
  const creatorValue = raw.model_creator
  let creator = ''
  if (isRecord(creatorValue)) {
    if (typeof creatorValue.name === 'string') creator = creatorValue.name
    else if (typeof creatorValue.id === 'string') creator = creatorValue.id
  }
  const evaluations = isRecord(raw.evaluations) ? raw.evaluations : {}
  const intelligenceIndex = numberOrNull(evaluations.artificial_analysis_intelligence_index)
  if (intelligenceIndex === null) return null
  const pricing = isRecord(raw.pricing) ? raw.pricing : {}
  const releaseDate = typeof raw.release_date === 'string' && raw.release_date !== '' ? raw.release_date : null
  const domains: Record<string, number> = {}
  for (const key of DOMAIN_KEYS) {
    const value = numberOrNull(evaluations[`artificial_analysis_${key}_index`])
    if (value !== null) domains[key] = value
  }
  return {
    slug,
    name,
    creator,
    releaseDate,
    intelligenceIndex,
    priceIn: numberOrNull(pricing.price_1m_input_tokens),
    priceOut: numberOrNull(pricing.price_1m_output_tokens),
    outputTokensPerSecond: numberOrNull(raw.median_output_tokens_per_second),
    timeToFirstTokenSeconds: numberOrNull(raw.median_time_to_first_token_seconds),
    domains,
  }
}

export function decodeAaPage(input: unknown): DecodedAaPage | DecodeFailure {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid' }
  const rawVersion = input.intelligence_index_version
  const version = typeof rawVersion === 'string' ? rawVersion.trim()
    : typeof rawVersion === 'number' && Number.isFinite(rawVersion) ? String(rawVersion) : ''
  if (version === '') return { ok: false, reason: 'invalid' }
  const pagination = isRecord(input.pagination) ? input.pagination : null
  const page = pagination !== null && typeof pagination.page === 'number' && Number.isFinite(pagination.page) ? Math.trunc(pagination.page) : 1
  const totalPages = pagination !== null && typeof pagination.total_pages === 'number' && Number.isFinite(pagination.total_pages)
    ? Math.trunc(pagination.total_pages)
    : null
  const hasMore = pagination !== null && typeof pagination.has_more === 'boolean'
    ? pagination.has_more
    : totalPages !== null && page < totalPages
  const entries: AaModelEntry[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const entry = decodeAaEntry(raw)
    if (entry !== null) entries.push(entry)
  }
  if (input.data.length > 0 && entries.length === 0) return { ok: false, reason: 'invalid' }
  return { ok: true, version, entries, hasMore, page, totalPages }
}

export interface DecodedOrMeta {
  version?: string
  startDate?: string
  endDate?: string
}

export interface DecodedOrRankings {
  ok: true
  asOf: string
  meta: DecodedOrMeta
  rows: OrRankingRow[]
}

function tokenString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  return null
}

/**
 * 날짜 범위·날짜별 개수·중복 키·총 행 수를 강제한다. 하나라도 위반하면 전체 응답을
 * 실패로 돌려 이전 스냅샷을 보존한다(D1 호출 예산 보호).
 */
export function decodeOrRankings(
  input: unknown,
  bounds?: { start: string; end: string },
): DecodedOrRankings | DecodeFailure {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid' }
  if (input.data.length > TREND_OR_MAX_ROWS) return { ok: false, reason: 'invalid' }
  const meta = isRecord(input.meta) ? input.meta : null
  const asOf = meta !== null && typeof meta.as_of === 'string' ? meta.as_of.trim() : ''
  const decodedMeta: DecodedOrMeta = {}
  if (meta !== null && typeof meta.version === 'string' && meta.version !== '') decodedMeta.version = meta.version
  if (meta !== null && typeof meta.start_date === 'string' && meta.start_date !== '') decodedMeta.startDate = meta.start_date
  if (meta !== null && typeof meta.end_date === 'string' && meta.end_date !== '') decodedMeta.endDate = meta.end_date
  const rows: OrRankingRow[] = []
  const seen = new Set<string>()
  const perDay = new Map<string, number>()
  for (const raw of input.data) {
    if (!isRecord(raw)) return { ok: false, reason: 'invalid' }
    const day = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : ''
    const permaslug = typeof raw.model_permaslug === 'string' && raw.model_permaslug !== '' ? raw.model_permaslug : ''
    const totalTokens = tokenString(raw.total_tokens)
    if (day === '' || permaslug === '' || totalTokens === null) return { ok: false, reason: 'invalid' }
    if (bounds !== undefined && (day < bounds.start || day > bounds.end)) return { ok: false, reason: 'invalid' }
    const key = `${day}\u0000${permaslug}`
    if (seen.has(key)) return { ok: false, reason: 'invalid' }
    seen.add(key)
    const count = (perDay.get(day) ?? 0) + 1
    if (count > TREND_OR_MAX_ROWS_PER_DAY) return { ok: false, reason: 'invalid' }
    perDay.set(day, count)
    rows.push({ day, permaslug, totalTokens })
  }
  return { ok: true, asOf, meta: decodedMeta, rows }
}
