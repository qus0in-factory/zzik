import { TREND_MODELS_DEV_URL, TREND_SOURCE_MODELS_DEV } from '../../../shared/trend-contract'
import { decodeModelsDev } from '../../domain/trend/sources'
import type { TrendSource, TrendSourceFailure } from '../../domain/trend/sources'

/** §3.1 메모리 게이트: 6.7MB 원문 + 파싱 트리를 20MB 이하 응답으로 제한한다. 로컬 측정은 결과 문서 참조. */
export const MODELS_DEV_MAX_BYTES = 20 * 1024 * 1024
export const MODELS_DEV_TIMEOUT_MS = 20_000

type BodyResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: 'network' | 'too_large' }

/** 본문을 스트림으로 읽어 누적 바이트가 상한을 넘는 즉시 중단한다. */
async function readCappedBody(response: Response, maxBytes: number): Promise<BodyResult> {
  const body = response.body
  if (body === null) {
    let text: string
    try {
      text = await response.text()
    } catch {
      return { ok: false, reason: 'network' }
    }
    const bytes = new TextEncoder().encode(text).length
    return bytes > maxBytes ? { ok: false, reason: 'too_large' } : { ok: true, text, bytes }
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
  } catch {
    return { ok: false, reason: 'network' }
  }
  return { ok: true, text: chunks.join(''), bytes }
}

export function createModelsDevSource(options: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}): TrendSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? MODELS_DEV_MAX_BYTES
  const timeoutMs = options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS
  return {
    id: TREND_SOURCE_MODELS_DEV,
    async fetch(etag) {
      const controller = new AbortController()
      // 타이머는 헤더 수신이 아니라 본문 읽기 완료(또는 실패)까지 유지한다.
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        let response: Response
        try {
          response = await fetchImpl(TREND_MODELS_DEV_URL, {
            headers: etag === null ? {} : { 'If-None-Match': etag },
            signal: controller.signal,
          })
        } catch {
          return { ok: false, reason: 'network', httpStatus: null } satisfies TrendSourceFailure
        }
        const responseEtag = response.headers.get('etag')
        if (response.status === 304) return { ok: true, notModified: true, etag: responseEtag ?? etag, bytes: 0 }
        if (response.status !== 200) return { ok: false, reason: 'http', httpStatus: response.status } satisfies TrendSourceFailure
        const declared = Number(response.headers.get('content-length') ?? 0)
        if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too_large', httpStatus: null } satisfies TrendSourceFailure
        const body = await readCappedBody(response, maxBytes)
        if (!body.ok) return { ok: false, reason: body.reason, httpStatus: null } satisfies TrendSourceFailure
        let parsed: unknown
        try {
          parsed = JSON.parse(body.text)
        } catch {
          return { ok: false, reason: 'invalid', httpStatus: null } satisfies TrendSourceFailure
        }
        const decoded = decodeModelsDev(parsed)
        if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null } satisfies TrendSourceFailure
        // 200에 ETag가 없으면 이전 validator를 재사용하지 않는다(null 저장).
        return { ok: true, notModified: false, etag: responseEtag, models: decoded.value, bytes: body.bytes }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
