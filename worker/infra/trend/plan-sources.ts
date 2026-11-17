import {
  TREND_GO_MODELS_URL,
  TREND_OLLAMA_TAGS_URL,
  TREND_SOURCE_OLLAMA_TAGS,
  TREND_SOURCE_OPENCODE_GO,
} from '../../../shared/trend-contract'
import { decodeGoModels, decodeOllamaTags } from '../../domain/trend/plan/decode'
import type { DecodePlanResult } from '../../domain/trend/plan/decode'
import type { PlanFetchResult, PlanSource } from '../../domain/trend/plan/types'
import { MODELS_DEV_TIMEOUT_MS, fetchJsonWithLimits } from './http-sources'

export const GO_MODELS_MAX_BYTES = 2 * 1024 * 1024
export const OLLAMA_TAGS_MAX_BYTES = 1 * 1024 * 1024

interface PlanSourceOptions {
  fetchImpl?: typeof fetch
  maxBytes?: number
  timeoutMs?: number
}

function createJsonPlanSource(input: {
  id: string
  plan: string
  url: string
  decode: (value: unknown) => DecodePlanResult
  options: PlanSourceOptions
  maxBytes: number
}): PlanSource {
  const fetchImpl = input.options.fetchImpl ?? globalThis.fetch
  const maxBytes = input.options.maxBytes ?? input.maxBytes
  const timeoutMs = input.options.timeoutMs ?? MODELS_DEV_TIMEOUT_MS
  return {
    id: input.id,
    plan: input.plan,
    async fetch(): Promise<PlanFetchResult> {
      const result = await fetchJsonWithLimits({
        fetchImpl,
        url: input.url,
        init: { redirect: 'manual' },
        maxBytes,
        timeoutMs,
      })
      if (!result.ok) return { ok: false, reason: result.reason, httpStatus: result.httpStatus }
      if (result.status !== 200) return { ok: false, reason: 'http', httpStatus: result.status }
      const decoded = input.decode(result.value)
      if (!decoded.ok) return { ok: false, reason: 'invalid', httpStatus: null }
      return { ok: true, observations: decoded.observations }
    },
  }
}

/** OpenCode Go 공개 모델 목록. 요금제 자체가 이 엔드포인트이므로 catalog 관측으로 쓴다. */
export function createOpenCodeGoSource(options: PlanSourceOptions = {}): PlanSource {
  return createJsonPlanSource({
    id: TREND_SOURCE_OPENCODE_GO,
    plan: 'opencode-go',
    url: TREND_GO_MODELS_URL,
    decode: decodeGoModels,
    options,
    maxBytes: GO_MODELS_MAX_BYTES,
  })
}

/** Ollama Cloud 공식 모델 목록(`/api/tags`). */
export function createOllamaTagsSource(options: PlanSourceOptions = {}): PlanSource {
  return createJsonPlanSource({
    id: TREND_SOURCE_OLLAMA_TAGS,
    plan: 'ollama-cloud',
    url: TREND_OLLAMA_TAGS_URL,
    decode: decodeOllamaTags,
    options,
    maxBytes: OLLAMA_TAGS_MAX_BYTES,
  })
}
