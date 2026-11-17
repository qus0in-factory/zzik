/** #116 공개 트렌드 계약. Worker 섹션 payload와 UI가 같은 타입을 쓴다. */
export const TREND_PUBLIC_PATH = '/pub/trend'
export const TREND_SECTIONS = ['plan-models', 'new-models', 'free-models', 'frontier', 'metrics'] as const
export type TrendSection = (typeof TREND_SECTIONS)[number]
export const TREND_SCHEMA_VERSION = 1
export const TREND_SECTION_MAX_BYTES = 100_000
export const TREND_NEW_MODELS_WINDOW_MS = 7 * 86_400_000
export const TREND_NEW_MODELS_RELEASE_MAX_MS = 30 * 86_400_000
export const TREND_NEW_MODELS_RULE = 'openrouter-registered-7d'
export const TREND_FREE_MODELS_WINDOW_MS = 7 * 86_400_000
export const TREND_FREE_MODELS_RULE = 'plan-included-opencode-go-ollama-cloud'
export const TREND_PLAN_WINDOW_MS = 14 * 86_400_000
export const TREND_PLAN_MODELS_RULE = 'plan-observation-14d'
export const TREND_SOURCE_MODELS_DEV = 'models.dev'
export const TREND_SOURCE_OPENCODE_ZEN = 'opencode-zen'
export const TREND_SOURCE_OPENROUTER = 'openrouter'
export const TREND_SOURCE_OPENCODE_GO = 'go-models'
export const TREND_SOURCE_OLLAMA_TAGS = 'ollama-tags'
export const TREND_SOURCE_ARTIFICIAL_ANALYSIS = 'artificial-analysis'
export const TREND_SOURCE_OPENROUTER_RANKINGS = 'openrouter-rankings'
export const TREND_MODELS_DEV_URL = 'https://models.dev/api.json'
export const TREND_ZEN_MODELS_URL = 'https://opencode.ai/zen/v1/models'
export const TREND_OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
export const TREND_GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models'
export const TREND_OLLAMA_TAGS_URL = 'https://ollama.com/api/tags'
export const TREND_AA_URL = 'https://artificialanalysis.ai/api/v2/language/models/free'
export const TREND_AA_LEADERBOARD_URL = 'https://artificialanalysis.ai/leaderboards/models'
export const TREND_OR_RANKINGS_URL = 'https://openrouter.ai/api/v1/datasets/rankings-daily'
export const TREND_METRICS_RULE = 'openrouter-usage-v1'
export const TREND_AA_TOP_N = 15
export const TREND_AA_MOVE_RANK_MAX = 30
export const TREND_AA_MOVE_THRESHOLD = 3
export const TREND_OR_TOP_N = 10
export const TREND_OR_MOVE_RANK_MAX = 30
export const TREND_OR_SHARE_DELTA = 0.01
export const TREND_OR_MAX_DAYS = 14
export const TREND_OR_MAX_ROWS_PER_DAY = 51
export const TREND_OR_MAX_ROWS = TREND_OR_MAX_DAYS * TREND_OR_MAX_ROWS_PER_DAY
export const TREND_OR_LICENSE_NAME = 'CC BY 4.0'
export const TREND_OR_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'

export type TrendPrecision = 'day' | 'month' | 'unknown'
export type TrendFreeKind = 'opencode-go' | 'ollama-cloud'

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
  /** free-models 전용: OpenCode Go 또는 Ollama Cloud 요금제 포함 그룹 */
  freeKind?: TrendFreeKind
  /** new-models 전용: AA 또는 OpenRouter에 새로 등록된 출처 */
  registeredIn?: ('aa' | 'openrouter')[]
  extra?: Record<string, string | number | boolean>
}

export interface TrendSourceState {
  id: string
  fetchedAt: string
  status: 'ok' | 'stale'
}

export type TrendMetricsBlockStatus = 'ok' | 'stale' | 'not_configured' | 'under_review'
export type TrendMetricsKind = 'new-top' | 'moved' | 'steady'
export type TrendMetricsNote = 'baseline' | 'version_changed' | 'source_failed' | 'terms_review'

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

export interface TrendMetricsMeta {
  version?: string
  startDate?: string
  endDate?: string
}

export interface TrendMetricsLicense {
  name: string
  url: string
}

export interface TrendMetricsBlock {
  id: 'aa-intelligence' | 'or-usage'
  status: TrendMetricsBlockStatus
  asOf: string
  /** asOf가 출처 meta.as_of인지, 메타데이터가 없어 조회 시각으로 대체했는지. */
  asOfKind?: 'source' | 'fetched'
  version?: string
  /** OpenRouter 응답의 meta.version/start_date/end_date 보존. */
  meta?: TrendMetricsMeta
  note?: TrendMetricsNote
  entries: TrendMetricsEntry[]
  /** 재배포 시 요구되는 고정 출처 문구(영문). UI는 t()로 같은 내용을 표시한다. */
  attribution: string
  /** OpenRouter CC BY 4.0 라이선스 링크. */
  license?: TrendMetricsLicense
  /** 원자료를 7일 창으로 집계·가공했음을 알리는 고지. */
  processed?: boolean
}

export type TrendPlanStatus = 'ok' | 'partial' | 'unavailable'
export type TrendPlanConfidence = 'account' | 'catalog' | 'doc' | 'partial'
export type TrendPlanNote = 'partial_judgement' | 'source_failed' | 'unverified' | 'not_implemented'

export interface TrendPlanItem {
  id: string
  name: string
  creator: string | null
  releaseDate: string | null
  precision: TrendPrecision
  firstSeenAt: string
  confidence: TrendPlanConfidence
  source: string
  /** models.dev 메타와 매칭되었는지. 실패하면 표시명만 보여 준다. */
  matched: boolean
  extra?: Record<string, string | number | boolean>
}

export interface TrendPlanGroup {
  id: string
  status: TrendPlanStatus
  items: TrendPlanItem[]
  note?: TrendPlanNote
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
  /** AA brief citation(완성된 문장 1개). 점수·순위·모델 id는 구조화 필드로 내지 않는다. */
  aaCitation?: string
  /** plan-models 섹션 전용. 다른 섹션 payload에는 없다. */
  plans?: TrendPlanGroup[]
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
