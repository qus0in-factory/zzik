/**
 * ADR 0.10 §7 bucket ports. The route reads stored boundaries; the 15-minute
 * cron writes them from raw events. Implementations live in infra.
 */
import type {
  UsageHistoryBucketsPage,
  UsageHistoryBucketsQuery,
  UsageHistorySample,
} from '../../../shared/usage-history-contract'
import type { UsageProvider } from '../../../shared/usage-contract'
import type { HistoryResult } from './history-store'

export interface BucketStore {
  readBuckets(provider: UsageProvider, query: UsageHistoryBucketsQuery): Promise<HistoryResult<UsageHistoryBucketsPage>>
}

/** A raw event plus its stored envelope; the writer needs both the sample and the bytes. */
export interface BucketEvent {
  sample: UsageHistorySample
  envelope: string
}

export interface BucketCheckpoint {
  lastProcessedId: string
  stalledAtMs: number | null
}

export interface BucketWritePageInput {
  provider: UsageProvider
  scanVersion: number
  dataGeneration: number
  /** Last event id in this page. Written only after the page's boundary upserts. */
  lastProcessedId: string
  points: BucketEvent[]
  flats: Array<{ bucketStartMs: number; event: BucketEvent }>
}

export interface BucketWriterStore {
  readCheckpoint(provider: UsageProvider, scanVersion: number, dataGeneration: number): Promise<BucketCheckpoint | null>
  readEventById(provider: UsageProvider, id: string): Promise<BucketEvent | null>
  readEventPageAfter(provider: UsageProvider, afterId: string, limit: number): Promise<BucketEvent[]>
  readFlatRepresentative(provider: UsageProvider, scanVersion: number, dataGeneration: number, bucketStartMs: number): Promise<UsageHistorySample | null>
  writePage(input: BucketWritePageInput): Promise<void>
  stall(provider: UsageProvider, scanVersion: number, dataGeneration: number, stalledAtMs: number): Promise<void>
}
