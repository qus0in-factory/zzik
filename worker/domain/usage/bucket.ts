/**
 * ADR 0.10 §7.1 bucket boundary fold. Pure, no clock or storage.
 * A `flat` representative replaces within one 900-second bucket; every failure,
 * gap, reset, series-set change or usedPercent change stays a `point`.
 */
import type { UsageHistorySample, UsageHistoryValue } from '../../../shared/usage-history-contract'
import { USAGE_BUCKET_MAX_POINTS, USAGE_BUCKET_SEC } from '../../../shared/usage-history-contract'

export const BUCKET_MS = USAGE_BUCKET_SEC * 1000
export const BUCKET_GAP_FALLBACK_SEC = 1_800

export interface BucketFoldState {
  /** Last processed event, including one before `from`, for gap/change comparison. */
  previous: UsageHistorySample | null
  /** Last flat success representative in the current bucket. */
  flat: UsageHistorySample | null
  flatBucketStartMs: number | null
}

export interface BucketFoldOptions {
  /** Inclusive response lower bound. Pre-range samples seed state but are not emitted. */
  fromMs: number
  /** Exclusive response upper bound. */
  untilMs: number
}

export interface BucketFoldPageResult {
  state: BucketFoldState
  points: UsageHistorySample[]
  /** Final flat representative per bucket in this page. */
  flats: Map<number, UsageHistorySample>
}

export function bucketStartMs(ms: number): number {
  return Math.floor(ms / BUCKET_MS) * BUCKET_MS
}

export function createBucketFoldState(previous: UsageHistorySample | null): BucketFoldState {
  const ms = previous === null ? NaN : Date.parse(previous.runAt)
  return {
    previous,
    flat: previous !== null && previous.status === 'ok' && previous.values !== null ? previous : null,
    flatBucketStartMs: Number.isFinite(ms) ? bucketStartMs(ms) : null,
  }
}

function seriesMap(values: readonly UsageHistoryValue[]): Map<string, { usedPercent: number; resetsAt: string | null }> {
  return new Map(values.map(item => [item.id, { usedPercent: item.usedPercent, resetsAt: item.resetsAt }]))
}

function sameSeries(previous: readonly UsageHistoryValue[], current: readonly UsageHistoryValue[]): boolean {
  if (previous.length !== current.length) return false
  const before = seriesMap(previous)
  const after = seriesMap(current)
  if (before.size !== after.size) return false
  for (const [id, value] of before) {
    const next = after.get(id)
    if (next === undefined || next.usedPercent !== value.usedPercent || next.resetsAt !== value.resetsAt) return false
  }
  return true
}

/** True means this sample must be stored as a `point`, not folded into the bucket `flat`. */
export function isBucketPoint(previous: UsageHistorySample | null, current: UsageHistorySample): boolean {
  if (current.status !== 'ok' || current.values === null) return true
  if (previous === null) return false
  const previousMs = Date.parse(previous.runAt)
  const currentMs = Date.parse(current.runAt)
  if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs) || currentMs < previousMs) return true
  const seconds = current.intervalSec ?? previous.intervalSec
  const gapLimitMs = Number.isFinite(seconds) && seconds !== null && seconds > 0
    ? seconds * 2_000
    : BUCKET_GAP_FALLBACK_SEC * 1_000
  if (currentMs - previousMs > gapLimitMs) return true
  // A failure/no-value sample already breaks the series. The next success starts a
  // fresh segment and can be the bucket flat; it is not an extra point.
  if (previous.status !== 'ok' || previous.values === null) return false
  return !sameSeries(previous.values, current.values)
}

/** Process one ordered page. Samples before `fromMs` seed `previous`/`flat` but are not emitted. */
export function foldBucketPage(state: BucketFoldState, samples: readonly UsageHistorySample[], options: BucketFoldOptions): BucketFoldPageResult {
  let previous = state.previous
  let flat = state.flat
  let flatBucketStartMs = state.flatBucketStartMs
  const points: UsageHistorySample[] = []
  const flats = new Map<number, UsageHistorySample>()

  for (const current of samples) {
    const ms = Date.parse(current.runAt)
    if (!Number.isFinite(ms) || ms >= options.untilMs) continue
    const bucket = bucketStartMs(ms)
    if (flatBucketStartMs !== bucket) {
      flat = null
      flatBucketStartMs = bucket
    }
    if (isBucketPoint(previous, current)) {
      if (ms >= options.fromMs) points.push(current)
    } else {
      flat = current
      if (ms >= options.fromMs) flats.set(bucket, current)
    }
    previous = current
  }

  return { state: { previous, flat, flatBucketStartMs }, points, flats }
}

function compareId(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left), b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  return left === right ? 0 : left < right ? -1 : 1
}

export function compareBucketSamples(left: UsageHistorySample, right: UsageHistorySample): number {
  if (left.runAt !== right.runAt) return left.runAt < right.runAt ? -1 : 1
  return compareId(left.id, right.id)
}

/** Merge point rows and one final flat per bucket, sorted by (runAt, id). */
export function mergeBucketSamples(points: readonly UsageHistorySample[], flats: ReadonlyMap<number, UsageHistorySample>): UsageHistorySample[] {
  const byId = new Map<string, UsageHistorySample>()
  for (const sample of points) byId.set(sample.id, sample)
  for (const sample of flats.values()) byId.set(sample.id, sample)
  return [...byId.values()].sort(compareBucketSamples)
}

/** The response never exceeds 4,000 points; when cut, keep the newest slice. */
export function truncateBucketSamples(
  samples: readonly UsageHistorySample[],
  maxPoints: number = USAGE_BUCKET_MAX_POINTS,
): { samples: UsageHistorySample[]; complete: boolean } {
  const sorted = [...samples].sort(compareBucketSamples)
  if (sorted.length <= maxPoints) return { samples: sorted, complete: true }
  return { samples: sorted.slice(sorted.length - maxPoints), complete: false }
}
