import type { TrendSection, TrendSectionPayload } from '../../../shared/trend-contract'

export interface TrendSectionRow {
  section: TrendSection
  payload: string
  payloadSha256: string
  generatedAt: number
}

export interface TrendSourceStateRow {
  source: string
  etag: string | null
  fetchedAt: number
  ok: boolean
  httpStatus: number | null
}

export interface TrendSeenRow {
  canonicalId: string
  firstSeenAt: number
  releaseDate: string | null
  source: string
}

export interface TrendStore {
  readSection(section: TrendSection): Promise<TrendSectionRow | null>
  readSections(): Promise<TrendSectionRow[]>
  /** payload를 저장하고 payload_sha256을 반환한다. 100KB를 넘으면 거부한다. */
  writeSection(payload: TrendSectionPayload): Promise<string>
  readSourceState(source: string): Promise<TrendSourceStateRow | null>
  writeSourceState(row: TrendSourceStateRow): Promise<void>
  readSeen(): Promise<TrendSeenRow[]>
  upsertSeen(rows: readonly TrendSeenRow[]): Promise<void>
}
