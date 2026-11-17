import {
  TREND_AA_URL,
  TREND_OR_RANKINGS_URL,
  TREND_SOURCE_ARTIFICIAL_ANALYSIS,
  TREND_SOURCE_OPENROUTER_RANKINGS,
} from '../../../shared/trend-contract'
import { decodeAaPage, decodeOrRankings } from '../../domain/trend/metrics/decode'
import { addDays, utcDay } from '../../domain/trend/metrics/types'
import type {
  AaFetchResult,
  AaModelEntry,
  AaSource,
  MetricsSourceFailure,
  MetricsSourceFailureReason,
  OrFetchResult,
  OrRankingSource,
} from '../../domain/trend/metrics/types'
import { MODELS_DEV_TIMEOUT_MS, fetchJsonWithLimits } from './http-sources'

export const AA_MAX_BYTES = 5 * 1024 * 1024
export const OR_RANKINGS_MAX_BYTES = 2 * 1024 * 1024
export const AA_MAX_PAGES = 5

function statusFailure(status: number): MetricsSourceFailure {
  if (status === 401 || status === 403) return { ok: false, reason: 'unauthorized', httpStatus: status }
  if (status === 429) return { ok: false, reason: 'rate_limited', httpStatus: status }
  return { ok: false, reason: 'http', httpStatus: status }
}

function requestFailure(reason: 'network' | 'too_large' | 'invalid', httpStatus: number | null): MetricsSourceFailure {
  const mapped: MetricsSourceFailureReason = reason
  return { ok: false, reason: mapped, httpStatus }
}

export interface AaSourceOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
  maxPages?: number
}

/** Artificial Analysis 무료 티어 전체 페이지를 읽어 Intelligence Index 스냅샷으로 만든다. */
export function createAaSource(options: AaSourceOptions): AaSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? AA_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS
  const maxPages = options.maxPages ?? AA_MAX_PAGES
  return {
    id: TREND_SOURCE_ARTIFICIAL_ANALYSIS,
    async fetch(nowMs): Promise<AaFetchResult> {
      if (options.apiKey.trim() === '') return { ok: false, reason: 'not_configured', httpStatus: null }
      const bySlug = new Map<string, AaModelEntry>()
      let version: string | null = null
      let page = 1
      for (;;) {
        if (page > maxPages) return { ok: false, reason: 'invalid', httpStatus: null }
        const url = `${TREND_AA_URL}?page=${page}`
        const result = await fetchJsonWithLimits({
          fetchImpl,
          url,
          init: { headers: { 'x-api-key': options.apiKey } },
          maxBytes,
          timeoutMs,
        })
        if (!result.ok) return requestFailure(result.reason, result.httpStatus)
        if (result.status !== 200) return statusFailure(result.status)
        const decoded = decodeAaPage(result.value)
        if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null }
        if (version === null) version = decoded.version
        else if (version !== decoded.version) return { ok: false, reason: 'invalid', httpStatus: null }
        for (const entry of decoded.entries) if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry)
        if (!decoded.hasMore) break
        if (decoded.totalPages !== null && page >= decoded.totalPages) break
        page += 1
      }
      return { ok: true, snapshot: { version: version ?? '', entries: [...bySlug.values()] } }
    },
  }
}

export interface OrRankingSourceOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

/** OpenRouter Data API의 최근 14일 일별 상위 50 모델 토큰 합을 읽는다. */
export function createOrRankingSource(options: OrRankingSourceOptions): OrRankingSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? OR_RANKINGS_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS
  return {
    id: TREND_SOURCE_OPENROUTER_RANKINGS,
    async fetch(nowMs): Promise<OrFetchResult> {
      if (options.apiKey.trim() === '') return { ok: false, reason: 'not_configured', httpStatus: null }
      const end = utcDay(nowMs)
      const start = addDays(end, -13)
      const url = `${TREND_OR_RANKINGS_URL}?start_date=${start}&end_date=${end}`
      const result = await fetchJsonWithLimits({
        fetchImpl,
        url,
        init: { headers: { Authorization: `Bearer ${options.apiKey}` } },
        maxBytes,
        timeoutMs,
      })
      if (!result.ok) return requestFailure(result.reason, result.httpStatus)
      if (result.status !== 200) return statusFailure(result.status)
      const decoded = decodeOrRankings(result.value)
      if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null }
      return {
        ok: true,
        snapshot: {
          asOf: decoded.asOf === '' ? new Date(nowMs).toISOString() : decoded.asOf,
          rows: decoded.rows,
        },
      }
    },
  }
}
