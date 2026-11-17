/** Artificial Analysis·OpenRouter 응답의 순수 디코더. I/O·시간 없음. */
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
    domains,
  }
}

export function decodeAaPage(input: unknown): DecodedAaPage | DecodeFailure {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid' }
  const version = typeof input.intelligence_index_version === 'string' ? input.intelligence_index_version.trim() : ''
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

export interface DecodedOrRankings {
  ok: true
  asOf: string
  rows: OrRankingRow[]
}

function tokenString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return value
  return null
}

export function decodeOrRankings(input: unknown): DecodedOrRankings | DecodeFailure {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid' }
  const meta = isRecord(input.meta) ? input.meta : null
  const asOf = meta !== null && typeof meta.as_of === 'string' ? meta.as_of : ''
  const rows: OrRankingRow[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const day = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : ''
    const permaslug = typeof raw.model_permaslug === 'string' && raw.model_permaslug !== '' ? raw.model_permaslug : ''
    const totalTokens = tokenString(raw.total_tokens)
    if (day === '' || permaslug === '' || totalTokens === null) continue
    rows.push({ day, permaslug, totalTokens })
  }
  if (input.data.length > 0 && rows.length === 0) return { ok: false, reason: 'invalid' }
  return { ok: true, asOf, rows }
}
