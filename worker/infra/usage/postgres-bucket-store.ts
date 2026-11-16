/**
 * ADR 0.10 §7.1 PostgreSQL fallback: fold raw events at request time.
 * PG tables are not extended; the 30-day read is derived from usage_event.
 */
import { USAGE_BUCKET_MAX_POINTS, USAGE_BUCKET_READ_BUDGET_MS, USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract'
import type { UsageHistoryBucketsPage, UsageHistoryBucketsQuery, UsageHistorySample } from '../../../shared/usage-history-contract'
import type { UsageProvider } from '../../../shared/usage-contract'
import { createBucketFoldState, foldBucketPage, mergeBucketSamples, truncateBucketSamples } from '../../domain/usage/bucket'
import type { BucketStore } from '../../domain/usage/bucket-store'
import { encodeCursor } from '../../domain/usage/history-query'
import { historySample } from '../../domain/usage/history-sample'
import type { HistoryResult, HistoryStore } from '../../domain/usage/history-store'

export interface PostgresBucketOptions {
  now?: () => number
  pageRows?: number
  maxPoints?: number
  budgetMs?: number
}

export class PostgresBucketStore implements BucketStore {
  private readonly now: () => number
  private readonly pageRows: number
  private readonly maxPoints: number
  private readonly budgetMs: number

  constructor(private readonly store: HistoryStore, options: PostgresBucketOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.pageRows = options.pageRows ?? 500
    this.maxPoints = options.maxPoints ?? USAGE_BUCKET_MAX_POINTS
    this.budgetMs = options.budgetMs ?? USAGE_BUCKET_READ_BUDGET_MS
  }

  async readBuckets(provider: UsageProvider, query: UsageHistoryBucketsQuery): Promise<HistoryResult<UsageHistoryBucketsPage>> {
    const started = this.now()
    const previous = await this.store.readRowBefore(provider, query.from)
    if (!previous.ok) return previous
    const anchor = await this.store.readAnchorRow(provider, query.from)
    if (!anchor.ok) return anchor

    let state = createBucketFoldState(previous.value === null ? null : historySample(provider, previous.value))
    const points: UsageHistorySample[] = []
    const flats = new Map<number, UsageHistorySample>()
    let complete = true
    let after: string | undefined

    for (;;) {
      if (this.now() - started > this.budgetMs) {
        complete = false
        break
      }
      const rows = await this.store.readRows(provider, {
        from: query.from,
        until: query.until,
        limit: this.pageRows,
        ...(after === undefined ? {} : { after }),
      })
      if (!rows.ok) return rows
      if (rows.value.length === 0) break
      const samples = rows.value.map(row => historySample(provider, row))
      const folded = foldBucketPage(state, samples, { fromMs: Date.parse(query.from), untilMs: Date.parse(query.until) })
      state = folded.state
      points.push(...folded.points)
      for (const [bucket, sample] of folded.flats) flats.set(bucket, sample)
      if (rows.value.length < this.pageRows) break
      const last = samples[samples.length - 1]!
      after = encodeCursor(last.runAt, last.id)
    }

    const merged = truncateBucketSamples(mergeBucketSamples(points, flats), this.maxPoints)
    const overBudget = this.now() - started > this.budgetMs
    return {
      ok: true,
      value: {
        provider,
        scanVersion: USAGE_HISTORY_SCAN_VERSION,
        bucketSec: query.bucketSec,
        from: query.from,
        until: query.until,
        samples: merged.samples,
        anchor: anchor.value === null ? null : historySample(provider, anchor.value),
        complete: complete && merged.complete && !overBudget,
      },
    }
  }
}
