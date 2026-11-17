/**
 * models.dev 응답을 표시용 모델 레코드로 정규화한다. 순수 함수 — I/O·시간 없음.
 * api.json은 provider→models, catalog.json은 providers 아래에 같은 구조다.
 */
import { isRecord } from '../../../shared/d1-canonical'
import type { TrendPrecision, TrendPrice } from '../../../shared/trend-contract'

export interface TrendModelRecord {
  canonicalId: string
  provider: string
  modelId: string
  name: string
  creator: string
  releaseDate: string | null
  releasePrecision: TrendPrecision
  releaseMs: number | null
  price: TrendPrice | null
  free: boolean
  openWeights: boolean
  status: string | null
}

export type DecodeModelsDevResult =
  | { ok: true; value: TrendModelRecord[] }
  | { ok: false; reason: 'invalid_source' }

interface Release {
  date: string | null
  precision: TrendPrecision
  ms: number | null
}

function parseRelease(value: unknown): Release {
  if (typeof value !== 'string') return { date: null, precision: 'unknown', ms: null }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (day !== null) {
    const year = Number(day[1]), month = Number(day[2]), date = Number(day[3])
    const ms = Date.UTC(year, month - 1, date)
    const parsed = new Date(ms)
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date) {
      return { date: value, precision: 'day', ms }
    }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value)
  if (month !== null) {
    const year = Number(month[1]), mon = Number(month[2])
    if (mon >= 1 && mon <= 12) return { date: value, precision: 'month', ms: Date.UTC(year, mon - 1, 1) }
  }
  return { date: null, precision: 'unknown', ms: null }
}

function parseCost(value: unknown): TrendPrice | null {
  if (!isRecord(value)) return null
  const input = value.input, output = value.output
  if (typeof input !== 'number' || typeof output !== 'number' || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return null
  return { input, output }
}

function creatorOf(canonicalId: string, provider: string): string {
  const slash = canonicalId.indexOf('/')
  return slash > 0 ? canonicalId.slice(0, slash) : provider
}

export function decodeModelsDev(input: unknown): DecodeModelsDevResult {
  if (!isRecord(input)) return { ok: false, reason: 'invalid_source' }
  if (input.providers !== undefined && !isRecord(input.providers)) return { ok: false, reason: 'invalid_source' }
  const providers = isRecord(input.providers) ? input.providers : input
  const providerEntries = Object.entries(providers)
  if (providerEntries.length === 0) return { ok: false, reason: 'invalid_source' }
  const records: TrendModelRecord[] = []
  let modelContainers = 0
  for (const [providerKey, providerValue] of providerEntries) {
    if (!isRecord(providerValue) || !isRecord(providerValue.models)) continue
    modelContainers += 1
    const provider = typeof providerValue.id === 'string' && providerValue.id !== '' ? providerValue.id : providerKey
    for (const [modelKey, modelValue] of Object.entries(providerValue.models)) {
      if (!isRecord(modelValue)) continue
      const modelId = typeof modelValue.id === 'string' && modelValue.id !== '' ? modelValue.id : modelKey
      if (modelId === '') continue
      const canonical = typeof modelValue.canonical_model_id === 'string' && modelValue.canonical_model_id !== '' ? modelValue.canonical_model_id : modelId
      const release = parseRelease(modelValue.release_date)
      const price = parseCost(modelValue.cost)
      const name = typeof modelValue.name === 'string' && modelValue.name !== '' ? modelValue.name : modelId
      records.push({
        canonicalId: canonical,
        provider,
        modelId,
        name,
        creator: creatorOf(canonical, provider),
        releaseDate: release.date,
        releasePrecision: release.precision,
        releaseMs: release.ms,
        price,
        free: price !== null && price.input === 0 && price.output === 0,
        openWeights: modelValue.open_weights === true,
        status: typeof modelValue.status === 'string' ? modelValue.status : null,
      })
    }
  }
  if (modelContainers === 0) return { ok: false, reason: 'invalid_source' }
  return { ok: true, value: records }
}

/** HTTP 출처 포트. app이 etag를 넘기고 infra가 조건부 GET을 한다. */
export interface TrendSourceFetchResult {
  ok: true
  notModified: boolean
  etag: string | null
  models?: TrendModelRecord[]
  bytes: number
}
export interface TrendSourceFailure {
  ok: false
  reason: 'http' | 'network' | 'invalid' | 'too_large'
  httpStatus: number | null
}
export interface TrendSource {
  id: string
  fetch(etag: string | null): Promise<TrendSourceFetchResult | TrendSourceFailure>
}
