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
  /** OpenRouter expiration_date 등 만료 시각(ms). 없으면 null. */
  expiresAtMs?: number | null
  limitedTime?: boolean
  limitedRegions?: boolean
  link?: string
}

export type DecodeModelsDevResult =
  | { ok: true; value: TrendModelRecord[] }
  | { ok: false; reason: 'invalid_source' }

interface Release {
  date: string | null
  precision: TrendPrecision
  ms: number | null
}

export function parseRelease(value: unknown): Release {
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

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** OpenRouter 가격은 토큰당 USD 문자열이다. 계약 단위(1M 토큰)로 환산한다. */
function perMillion(value: unknown): number | null {
  const perToken = parseNumber(value)
  if (perToken === null || perToken < 0) return null
  return Number((perToken * 1_000_000).toFixed(6))
}

function fromUnixSeconds(value: unknown): Release {
  const seconds = parseNumber(value)
  if (seconds === null || seconds < 0) return { date: null, precision: 'unknown', ms: null }
  const ms = Math.trunc(seconds * 1000)
  return { date: new Date(ms).toISOString().slice(0, 10), precision: 'day', ms }
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


/**
 * OpenCode Zen `/zen/v1/models`: `{object:'list', data:[...]}`.
 * 무료 판정은 `cost.text.input.price == 0 && output.price == 0`이다.
 */
export function decodeZenModels(input: unknown): DecodeModelsDevResult {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid_source' }
  const records: TrendModelRecord[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const modelId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
    if (modelId === '') continue
    const canonical = typeof raw.canonical_id === 'string' && raw.canonical_id !== '' ? raw.canonical_id : modelId
    const release = parseRelease(raw.release_date)
    const cost = isRecord(raw.cost) && isRecord(raw.cost.text) ? raw.cost.text : null
    // Zen 가격은 이미 USD/1M 토큰 단위다.
    const inputPrice = cost !== null && isRecord(cost.input) ? parseNumber(cost.input.price) : null
    const outputPrice = cost !== null && isRecord(cost.output) ? parseNumber(cost.output.price) : null
    const price = inputPrice !== null && outputPrice !== null ? { input: inputPrice, output: outputPrice } : null
    records.push({
      canonicalId: canonical,
      provider: 'opencode',
      modelId,
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : modelId,
      creator: creatorOf(canonical, 'opencode'),
      releaseDate: release.date,
      releasePrecision: release.precision,
      releaseMs: release.ms,
      price,
      free: price !== null && price.input === 0 && price.output === 0,
      openWeights: raw.open_weights === true,
      status: raw.deprecated === true ? 'deprecated' : null,
      expiresAtMs: null,
    })
  }
  if (input.data.length > 0 && records.length === 0) return { ok: false, reason: 'invalid_source' }
  return { ok: true, value: records }
}

/**
 * OpenRouter `/api/v1/models`: `{data:[...]}`. 무료 판정은 `:free` 접미 또는 가격 0이다.
 * `created`는 출시일이 아니라 OpenRouter 등록일이므로 그대로 precision:'day'로 쓴다.
 */
export function decodeOpenRouterModels(input: unknown): DecodeModelsDevResult {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid_source' }
  const records: TrendModelRecord[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const modelId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
    if (modelId === '') continue
    const canonical = modelId.replace(/:free$/, '')
    const release = fromUnixSeconds(raw.created)
    const pricing = isRecord(raw.pricing) ? raw.pricing : null
    const prompt = pricing === null ? null : perMillion(pricing.prompt)
    const completion = pricing === null ? null : perMillion(pricing.completion)
    const price = prompt !== null && completion !== null ? { input: prompt, output: completion } : null
    const free = modelId.endsWith(':free') || (prompt === 0 && completion === 0)
    const expires = parseRelease(raw.expiration_date)
    records.push({
      canonicalId: canonical,
      provider: 'openrouter',
      modelId,
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : modelId,
      creator: creatorOf(canonical, 'openrouter'),
      releaseDate: release.date,
      releasePrecision: release.precision,
      releaseMs: release.ms,
      price,
      free,
      openWeights: typeof raw.hugging_face_id === 'string' && raw.hugging_face_id !== '',
      status: null,
      expiresAtMs: expires.ms,
    })
  }
  if (input.data.length > 0 && records.length === 0) return { ok: false, reason: 'invalid_source' }
  return { ok: true, value: records }
}

const OPENCODE_GO_PRICING_URL = 'https://opencode.ai/console/go#pricing'

/**
 * OpenCode Go `/inference/go/v1/models`: `{object:'list', data:[...]}`.
 * 무료 판정은 `cost.text.input.price == 0 && output.price == 0`이며 `go.limited_regions`를 함께 읽는다.
 */
export function decodeGoModels(input: unknown): DecodeModelsDevResult {
  if (!isRecord(input) || !Array.isArray(input.data)) return { ok: false, reason: 'invalid_source' }
  const records: TrendModelRecord[] = []
  for (const raw of input.data) {
    if (!isRecord(raw)) continue
    const modelId = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
    if (modelId === '') continue
    const canonical = typeof raw.canonical_id === 'string' && raw.canonical_id !== '' ? raw.canonical_id : modelId
    const release = parseRelease(raw.release_date)
    const cost = isRecord(raw.cost) && isRecord(raw.cost.text) ? raw.cost.text : null
    const inputPrice = cost !== null && isRecord(cost.input) ? parseNumber(cost.input.price) : null
    const outputPrice = cost !== null && isRecord(cost.output) ? parseNumber(cost.output.price) : null
    const price = inputPrice !== null && outputPrice !== null ? { input: inputPrice, output: outputPrice } : null
    const free = price !== null && price.input === 0 && price.output === 0
    const go = isRecord(raw.go) ? raw.go : null
    const description = typeof raw.description === 'string' ? raw.description : ''
    const limitedRegions = go?.limited_regions === true
    const limitedTime = free && (go === null || go.monthly_usage === null || /limited time/i.test(description))
    records.push({
      canonicalId: canonical,
      provider: 'opencode-go',
      modelId,
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : modelId,
      creator: creatorOf(canonical, 'opencode-go'),
      releaseDate: release.date,
      releasePrecision: release.precision,
      releaseMs: release.ms,
      price,
      free,
      openWeights: raw.open_weights === true,
      status: raw.deprecated === true ? 'deprecated' : null,
      expiresAtMs: null,
      limitedTime,
      limitedRegions,
      link: OPENCODE_GO_PRICING_URL,
    })
  }
  if (input.data.length > 0 && records.length === 0) return { ok: false, reason: 'invalid_source' }
  return { ok: true, value: records }
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function rssTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block)
  return match === null ? '' : decodeXmlEntities(match[1] ?? '')
}

/**
 * Ollama 블로그 RSS(`/blog/rss.xml`)에서 기간 한정 무료 공지를 추출한다.
 * `freely available` 또는 `for a limited time` + `free`가 포함된 항목만 선택한다.
 */
export function decodeOllamaBlogRss(xmlText: string): DecodeModelsDevResult {
  if (typeof xmlText !== 'string' || !/<rss\b|<channel\b/i.test(xmlText)) return { ok: false, reason: 'invalid_source' }
  const records: TrendModelRecord[] = []
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  for (const match of xmlText.matchAll(itemPattern)) {
    const block = match[1] ?? ''
    const title = rssTag(block, 'title')
    const link = rssTag(block, 'link')
    const pubDate = rssTag(block, 'pubDate')
    const description = rssTag(block, 'description')
    const haystack = `${title} ${description}`
    if (!/\b(?:freely available|for a limited time)\b/i.test(haystack) || !/\bfree(?:ly)?\b/i.test(haystack)) continue
    if (title === '' || link === '') continue
    const parsedMs = pubDate === '' ? NaN : Date.parse(pubDate)
    const releaseMs = Number.isFinite(parsedMs) ? parsedMs : null
    const releaseDate = releaseMs === null ? null : new Date(releaseMs).toISOString().slice(0, 10)
    const slug = link.replace(/\/+$/, '').split('/').pop() ?? title
    records.push({
      canonicalId: `ollama-blog:${slug}`,
      provider: 'ollama-cloud',
      modelId: slug,
      name: title,
      creator: 'ollama',
      releaseDate,
      releasePrecision: releaseDate === null ? 'unknown' : 'day',
      releaseMs,
      price: { input: 0, output: 0 },
      free: true,
      openWeights: true,
      status: null,
      expiresAtMs: null,
      limitedTime: true,
      link,
    })
  }
  return { ok: true, value: records }
}
