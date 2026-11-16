/**
 * ADR 0.10 §7.2 single 15-minute writer. Checkpoint advances only after the
 * page's boundary upserts; a missing checkpoint event stalls that provider.
 */
import { USAGE_PROVIDERS } from '../../../shared/usage-contract'
import type { UsageProvider } from '../../../shared/usage-contract'
import { bucketStartMs, createBucketFoldState, foldBucketPage } from '../../domain/usage/bucket'
import type { BucketWriterStore } from '../../domain/usage/bucket-store'

export interface BucketWriterOptions {
  scanVersion: number
  dataGeneration: number
  nowMs: number
  providers?: readonly UsageProvider[]
  pageRows?: number
}

export type BucketWriterResult =
  | { ok: true; value: { providers: number; pages: number; points: number; flats: number; stalled: number } }
  | { ok: false; reason: 'bucket_write_failed' }

export async function runBucketWriter(store: BucketWriterStore, options: BucketWriterOptions): Promise<BucketWriterResult> {
  const providers = options.providers ?? USAGE_PROVIDERS
  const pageRows = options.pageRows ?? 100
  let pages = 0
  let points = 0
  let flats = 0
  let stalled = 0

  for (const provider of providers) {
    const checkpoint = await store.readCheckpoint(provider, options.scanVersion, options.dataGeneration)
    if (checkpoint?.stalledAtMs !== null && checkpoint?.stalledAtMs !== undefined) {
      stalled += 1
      continue
    }
    let lastId = checkpoint?.lastProcessedId ?? '0'
    let previous = lastId === '0' ? null : await store.readEventById(provider, lastId)
    if (lastId !== '0' && previous === null) {
      await store.stall(provider, options.scanVersion, options.dataGeneration, options.nowMs)
      stalled += 1
      continue
    }

    let state = createBucketFoldState(previous?.sample ?? null)
    if (previous !== null) {
      const bucket = bucketStartMs(Date.parse(previous.sample.runAt))
      state = {
        previous: previous.sample,
        flat: await store.readFlatRepresentative(provider, options.scanVersion, options.dataGeneration, bucket),
        flatBucketStartMs: bucket,
      }
    }

    for (;;) {
      const events = await store.readEventPageAfter(provider, lastId, pageRows)
      if (events.length === 0) break
      const samples = events.map(event => event.sample)
      const folded = foldBucketPage(state, samples, { fromMs: 0, untilMs: Number.POSITIVE_INFINITY })
      state = folded.state
      const byId = new Map(events.map(event => [event.sample.id, event]))
      const pagePoints = folded.points.map(sample => byId.get(sample.id)).filter((event): event is NonNullable<typeof event> => event !== undefined)
      const pageFlats = [...folded.flats].flatMap(([bucketStart, sample]) => {
        const event = byId.get(sample.id)
        return event === undefined ? [] : [{ bucketStartMs: bucketStart, event }]
      })
      const last = events[events.length - 1]!.sample.id
      try {
        await store.writePage({
          provider,
          scanVersion: options.scanVersion,
          dataGeneration: options.dataGeneration,
          lastProcessedId: last,
          points: pagePoints,
          flats: pageFlats,
        })
      } catch {
        return { ok: false, reason: 'bucket_write_failed' }
      }
      pages += 1
      points += pagePoints.length
      flats += pageFlats.length
      lastId = last
      if (events.length < pageRows) break
    }
  }

  return { ok: true, value: { providers: providers.length, pages, points, flats, stalled } }
}
