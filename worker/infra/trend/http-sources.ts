import {
  TREND_GO_MODELS_URL,
  TREND_MODELS_DEV_URL,
  TREND_OPENROUTER_MODELS_URL,
  TREND_SOURCE_MODELS_DEV,
  TREND_SOURCE_OPENCODE_GO,
  TREND_SOURCE_OPENCODE_ZEN,
  TREND_SOURCE_OPENROUTER,
  TREND_ZEN_MODELS_URL,
} from '../../../shared/trend-contract'
import { decodeGoModels, decodeModelsDev, decodeOpenRouterModels, decodeZenModels } from '../../domain/trend/sources'
import type { DecodeModelsDevResult, TrendSource, TrendSourceFailure } from '../../domain/trend/sources'

/** §3.1 메모리 게이트: 6.7MB 원문 + 파싱 트리를 12MB 이하 응답으로 제한한다. */
export const MODELS_DEV_MAX_BYTES = 12 * 1024 * 1024
export const MODELS_DEV_TIMEOUT_MS = 20_000
export const ZEN_MAX_BYTES = 5 * 1024 * 1024
export const OPENROUTER_MAX_BYTES = 10 * 1024 * 1024

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

export interface JsonRequestOptions {
  fetchImpl: typeof fetch
  url: string
  init?: RequestInit
  maxBytes: number
  timeoutMs: number
}

export type JsonRequestResult =
  | { ok: true; status: number; etag: string | null; value: unknown; bytes: number }
  | { ok: false; reason: 'network' | 'too_large' | 'invalid'; httpStatus: number | null }

/**
 * GET + 스트림 크기/timeout 게이트를 공통 적용한다. 2xx가 아니면 본문을 읽지 않고
 * `value:null`로 돌려주므로 호출자가 304·401·429를 구분한다.
 */
export async function fetchJsonWithLimits(options: JsonRequestOptions): Promise<JsonRequestResult> {
  const controller = new AbortController()
  // 타이머는 헤더 수신이 아니라 본문 읽기 완료(또는 실패)까지 유지한다.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    let response: Response
    try {
      response = await options.fetchImpl(options.url, { ...options.init, signal: controller.signal })
    } catch {
      return { ok: false, reason: 'network', httpStatus: null }
    }
    const etag = response.headers.get('etag')
    if (response.status !== 200) return { ok: true, status: response.status, etag, value: null, bytes: 0 }
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(declared) && declared > options.maxBytes) return { ok: false, reason: 'too_large', httpStatus: null }
    const body = await readCappedBody(response, options.maxBytes)
    if (!body.ok) return { ok: false, reason: body.reason, httpStatus: null }
    let value: unknown
    try {
      value = JSON.parse(body.text)
    } catch {
      return { ok: false, reason: 'invalid', httpStatus: null }
    }
    return { ok: true, status: 200, etag, value, bytes: body.bytes }
  } finally {
    clearTimeout(timer)
  }
}

interface JsonSourceOptions {
  id: string
  url: string
  decode: (input: unknown) => DecodeModelsDevResult
  fetchImpl?: typeof fetch
  maxBytes: number
  timeoutMs: number
}

/** 조건부 GET + 스트림 크기/timeout 게이트를 공통 적용하는 JSON 출처 어댑터. */
function createJsonSource(options: JsonSourceOptions): TrendSource {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  return {
    id: options.id,
    async fetch(etag) {
      const result = await fetchJsonWithLimits({
        fetchImpl,
        url: options.url,
        init: { headers: etag === null ? {} : { 'If-None-Match': etag } },
        maxBytes: options.maxBytes,
        timeoutMs: options.timeoutMs,
      })
      if (!result.ok) return { ok: false, reason: result.reason, httpStatus: result.httpStatus } satisfies TrendSourceFailure
      if (result.status === 304) return { ok: true, notModified: true, etag: result.etag ?? etag, bytes: 0 }
      if (result.status !== 200) return { ok: false, reason: 'http', httpStatus: result.status } satisfies TrendSourceFailure
      const decoded = options.decode(result.value)
      if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null } satisfies TrendSourceFailure
      // 200에 ETag가 없으면 이전 validator를 재사용하지 않는다(null 저장).
      return { ok: true, notModified: false, etag: result.etag, models: decoded.value, bytes: result.bytes }
    },
  }
}

export interface HttpSourceOptions {
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

export function createModelsDevSource(options: HttpSourceOptions = {}): TrendSource {
  return createJsonSource({
    id: TREND_SOURCE_MODELS_DEV,
    url: TREND_MODELS_DEV_URL,
    decode: decodeModelsDev,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes ?? MODELS_DEV_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS,
  })
}

export function createZenSource(options: HttpSourceOptions = {}): TrendSource {
  return createJsonSource({
    id: TREND_SOURCE_OPENCODE_ZEN,
    url: TREND_ZEN_MODELS_URL,
    decode: decodeZenModels,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes ?? ZEN_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS,
  })
}

export function createOpenRouterSource(options: HttpSourceOptions = {}): TrendSource {
  return createJsonSource({
    id: TREND_SOURCE_OPENROUTER,
    url: TREND_OPENROUTER_MODELS_URL,
    decode: decodeOpenRouterModels,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes ?? OPENROUTER_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS,
  })
}

export function createGoModelsSource(options: HttpSourceOptions = {}): TrendSource {
  return createJsonSource({
    id: TREND_SOURCE_OPENCODE_GO,
    url: TREND_GO_MODELS_URL,
    decode: decodeGoModels,
    fetchImpl: options.fetchImpl,
    maxBytes: options.maxBytes ?? ZEN_MAX_BYTES,
    timeoutMs: options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS,
  })
}
