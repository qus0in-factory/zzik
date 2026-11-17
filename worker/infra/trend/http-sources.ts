import { TREND_MODELS_DEV_URL, TREND_SOURCE_MODELS_DEV } from '../../../shared/trend-contract'
import { decodeModelsDev } from '../../domain/trend/sources'
import type { TrendSource, TrendSourceFailure } from '../../domain/trend/sources'

/** §3.1 메모리 게이트: 6.7MB 원문 + 파싱 트리를 20MB 이하 응답으로 제한한다. 로컬 측정은 결과 문서 참조. */
export const MODELS_DEV_MAX_BYTES = 20 * 1024 * 1024
export const MODELS_DEV_TIMEOUT_MS = 20_000

export function createModelsDevSource(options: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}): TrendSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? MODELS_DEV_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS
  return {
    id: TREND_SOURCE_MODELS_DEV,
    async fetch(etag) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response: Response
      try {
        response = await fetchImpl(TREND_MODELS_DEV_URL, {
          headers: etag === null ? {} : { 'If-None-Match': etag },
          signal: controller.signal,
        })
      } catch {
        return { ok: false, reason: 'network', httpStatus: null } satisfies TrendSourceFailure
      } finally {
        clearTimeout(timer)
      }
      const nextEtag = response.headers.get('etag') ?? etag
      if (response.status === 304) return { ok: true, notModified: true, etag: nextEtag, bytes: 0 }
      if (response.status !== 200) return { ok: false, reason: 'http', httpStatus: response.status } satisfies TrendSourceFailure
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large', httpStatus: null } satisfies TrendSourceFailure
      let text: string
      try {
        text = await response.text()
      } catch {
        return { ok: false, reason: 'network', httpStatus: null } satisfies TrendSourceFailure
      }
      const bytes = new TextEncoder().encode(text).length
      if (bytes > maxBytes) return { ok: false, reason: 'too_large', httpStatus: null } satisfies TrendSourceFailure
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return { ok: false, reason: 'invalid', httpStatus: null } satisfies TrendSourceFailure
      }
      const decoded = decodeModelsDev(parsed)
      if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null } satisfies TrendSourceFailure
      return { ok: true, notModified: false, etag: nextEtag, models: decoded.value, bytes }
    },
  }
}
