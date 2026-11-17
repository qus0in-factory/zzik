/** OpenCode Go·Ollama 공개 응답의 순수 디코더. I/O·시간 없음. */
import {
  TREND_SOURCE_OLLAMA_TAGS,
  TREND_SOURCE_OPENCODE_GO,
} from '../../../../shared/trend-contract'
import { isRecord } from '../../../../shared/d1-canonical'
import type { PlanObservation } from './types'

export type DecodePlanResult =
  | { ok: true; observations: PlanObservation[] }
  | { ok: false; reason: 'invalid' }

function unique(observations: PlanObservation[]): PlanObservation[] {
  const byId = new Map<string, PlanObservation>()
  for (const observation of observations) if (!byId.has(observation.modelId)) byId.set(observation.modelId, observation)
  return [...byId.values()]
}

/**
 * OpenCode Go `/inference/go/v1/models`: `{object:'list', data:[...]}`.
 * 이 엔드포인트 자체가 Go 요금제 목록이므로 모든 유효 모델을 catalog 관측으로 쓴다.
 */
export function decodeGoModels(input: unknown): DecodePlanResult {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid' }
  const observations: PlanObservation[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const id = typeof raw.canonical_id === 'string' && raw.canonical_id !== ''
      ? raw.canonical_id
      : typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
    if (id === '') continue
    const displayName = typeof raw.name === 'string' && raw.name !== '' ? raw.name : id
    observations.push({
      plan: 'opencode-go',
      modelId: id,
      displayName,
      source: TREND_SOURCE_OPENCODE_GO,
      confidence: 'catalog',
    })
  }
  if (input.data.length > 0 && observations.length === 0) return { ok: false, reason: 'invalid' }
  return { ok: true, observations: unique(observations) }
}

/**
 * Ollama `/api/tags`: `{models:[{name|model,...}]}`. 공식 안내된 Ollama Cloud 목록 출처다.
 * size=0은 cloud-only 힌트일 뿐이므로 목록 자체를 그대로 catalog 관측으로 쓴다.
 */
export function decodeOllamaTags(input: unknown): DecodePlanResult {
  if (!isRecord(input) || !Array.isArray(input.models)) return { ok: false, reason: 'invalid' }
  const observations: PlanObservation[] = []
  for (const raw of input.models) {
    if (!isRecord(raw)) continue
    const name = typeof raw.name === 'string' && raw.name !== ''
      ? raw.name
      : typeof raw.model === 'string' && raw.model !== '' ? raw.model : ''
    if (name === '') continue
    observations.push({
      plan: 'ollama-cloud',
      modelId: name,
      displayName: name,
      source: TREND_SOURCE_OLLAMA_TAGS,
      confidence: 'catalog',
    })
  }
  if (input.models.length > 0 && observations.length === 0) return { ok: false, reason: 'invalid' }
  return { ok: true, observations: unique(observations) }
}
