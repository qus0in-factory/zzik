/** #116 공개 트렌드 계약. Worker 섹션 payload와 UI가 같은 타입을 쓴다. */
export const TREND_PUBLIC_PATH = '/pub/trend'
export const TREND_SECTIONS = ['new-models', 'free-models', 'frontier'] as const
export type TrendSection = (typeof TREND_SECTIONS)[number]
export const TREND_SCHEMA_VERSION = 1
export const TREND_SECTION_MAX_BYTES = 100_000
export const TREND_NEW_MODELS_WINDOW_MS = 7 * 86_400_000
export const TREND_NEW_MODELS_RELEASE_MAX_MS = 30 * 86_400_000
export const TREND_NEW_MODELS_RULE = 'release-or-first-seen-7d'
export const TREND_SOURCE_MODELS_DEV = 'models.dev'
export const TREND_MODELS_DEV_URL = 'https://models.dev/api.json'

export type TrendPrecision = 'day' | 'month' | 'unknown'

export interface TrendPrice {
  input: number
  output: number
}

export interface TrendItem {
  /** canonical_model_id 기준 중복 제거 키 */
  id: string
  name: string
  creator: string
  releaseDate: string | null
  precision: TrendPrecision
  price: TrendPrice | null
  free: boolean
  openWeights: boolean
  providers: string[]
  links: { modelsDev?: string; openrouter?: string; opencode?: string }
  extra?: Record<string, string | number | boolean>
}

export interface TrendSourceState {
  id: string
  fetchedAt: string
  status: 'ok' | 'stale'
}

export interface TrendSectionPayload {
  section: TrendSection
  schemaVersion: number
  generatedAt: string
  rule: string
  sources: TrendSourceState[]
  items: TrendItem[]
}

export interface TrendIndexSection {
  id: TrendSection
  count: number
  generatedAt: string
  status: 'ok' | 'stale' | 'not_ready'
}

export interface TrendIndex {
  generatedAt: string
  sections: TrendIndexSection[]
}
