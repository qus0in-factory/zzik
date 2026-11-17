/** #116 공개 트렌드 계약. Worker 섹션 payload와 UI가 같은 타입을 쓴다. */
export const TREND_PUBLIC_PATH = '/pub/trend'
export const TREND_SECTIONS = ['new-models', 'free-models', 'frontier', 'metrics'] as const
export type TrendSection = (typeof TREND_SECTIONS)[number]
export const TREND_SCHEMA_VERSION = 1
export const TREND_SECTION_MAX_BYTES = 100_000
export const TREND_NEW_MODELS_WINDOW_MS = 7 * 86_400_000
export const TREND_NEW_MODELS_RELEASE_MAX_MS = 30 * 86_400_000
export const TREND_NEW_MODELS_RULE = 'release-or-first-seen-7d'
export const TREND_FREE_MODELS_WINDOW_MS = 30 * 86_400_000
export const TREND_FREE_MODELS_RULE = 'hosted-free-or-local-30d'
export const TREND_SOURCE_MODELS_DEV = 'models.dev'
export const TREND_SOURCE_OPENCODE_ZEN = 'opencode-zen'
export const TREND_SOURCE_OPENROUTER = 'openrouter'
export const TREND_SOURCE_ARTIFICIAL_ANALYSIS = 'artificial-analysis'
export const TREND_SOURCE_OPENROUTER_RANKINGS = 'openrouter-rankings'
export const TREND_MODELS_DEV_URL = 'https://models.dev/api.json'
export const TREND_ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models'
export const TREND_OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
export const TREND_AA_URL = 'https://artificialanalysis.ai/api/v2/language/models/free'
export const TREND_OR_RANKINGS_URL = 'https://openrouter.ai/api/v1/datasets/rankings-daily'
export const TREND_METRICS_RULE = 'aa-intelligence-and-or-usage-v1'
export const TREND_AA_TOP_N = 15
export const TREND_AA_MOVE_RANK_MAX = 30
export const TREND_AA_MOVE_THRESHOLD = 3
export const TREND_OR_TOP_N = 10
export const TREND_OR_MOVE_RANK_MAX = 30
export const TREND_OR_SHARE_DELTA = 0.01

export type TrendPrecision = 'day' | 'month' | 'unknown'
export type TrendFreeKind = 'hosted' | 'local'

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
  /** free-models 전용: 호스팅 무료 또는 로컬 실행 가능 하위 그룹 */
  freeKind?: 'hosted' | 'local'
  extra?: Record<string, string | number | boolean>
}

export interface TrendSourceState {
  id: string
  fetchedAt: string
  status: 'ok' | 'stale'
}

export type TrendMetricsBlockStatus = 'ok' | 'stale' | 'not_configured'
export type TrendMetricsKind = 'new-top' | 'moved' | 'steady'
export type TrendMetricsNote = 'baseline' | 'version_changed' | 'source_failed'

export interface TrendMetricsEntry {
  id: string
  name: string
  creator: string | null
  rank: number
  /** 이전 스냅샷 대비 순위 변화(양수 = 상승). 비교 불가면 null. */
  rankDelta: number | null
  kind: TrendMetricsKind
  /** AA Intelligence Index */
  index?: number
  /** OpenRouter 7일 점유율(0~1) */
  share7d?: number
  /** OpenRouter 점유율 변화(0~1, 양수 = 상승) */
  shareDelta?: number
}

export interface TrendMetricsBlock {
  id: 'aa-intelligence' | 'or-usage'
  status: TrendMetricsBlockStatus
  asOf: string
  version?: string
  note?: TrendMetricsNote
  entries: TrendMetricsEntry[]
  /** 재배포 시 요구되는 고정 출처 문구(영문). UI는 t()로 같은 내용을 표시한다. */
  attribution: string
}

export interface TrendSectionPayload {
  section: TrendSection
  schemaVersion: number
  generatedAt: string
  rule: string
  sources: TrendSourceState[]
  items: TrendItem[]
  /** metrics 섹션 전용. 다른 섹션 payload에는 없다. */
  blocks?: TrendMetricsBlock[]
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
