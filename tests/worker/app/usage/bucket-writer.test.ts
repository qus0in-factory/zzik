import { describe, expect, it } from 'vitest'
import { runBucketWriter } from '../../../../worker/app/usage/bucket-writer'
import type { BucketCheckpoint, BucketEvent, BucketStore, BucketWritePageInput, BucketWriterStore } from '../../../../worker/domain/usage/bucket-store'
import type { UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { UsageProvider } from '../../../../shared/usage-contract'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'

const T0 = Date.parse('2026-11-16T00:00:00.000Z')
const provider: UsageProvider = 'claude'

const sample = (id: string, atMs: number, usedPercent = 10, overrides: Partial<UsageHistorySample> = {}): UsageHistorySample => ({
  id,
  runAt: new Date(atMs).toISOString(),
  status: 'ok',
  fetchedAt: new Date(atMs).toISOString(),
  intervalSec: 180,
  values: [{ id: 'five_hour', usedPercent, resetsAt: null, cycleSeconds: null }],
  ...overrides,
})

const event = (sample: UsageHistorySample): BucketEvent => ({ sample, envelope: JSON.stringify({ fetchedAt: sample.fetchedAt, intervalSec: sample.intervalSec, rawText: '{}' }) })

const compare = (a: string, b: string): number => {
  const left = BigInt(a), right = BigInt(b)
  return left < right ? -1 : left > right ? 1 : 0
}

class FakeBucketWriterStore implements BucketWriterStore {
  events: BucketEvent[] = []
  checkpoints = new Map<UsageProvider, BucketCheckpoint>()
  flats = new Map<number, UsageHistorySample>()
  pages: BucketWritePageInput[] = []
  stalls: Array<{ provider: UsageProvider; at: number }> = []
  flatReads: number[] = []
  failPageAt: number | null = null

  async readCheckpoint(current: UsageProvider): Promise<BucketCheckpoint | null> {
    return this.checkpoints.get(current) ?? null
  }

  async readEventById(_provider: UsageProvider, id: string): Promise<BucketEvent | null> {
    return this.events.find(item => item.sample.id === id) ?? null
  }

  async readEventPageAfter(_provider: UsageProvider, afterId: string, limit: number): Promise<BucketEvent[]> {
    return this.events
      .filter(item => compare(item.sample.id, afterId) > 0)
      .sort((left, right) => compare(left.sample.id, right.sample.id))
      .slice(0, limit)
  }

  async readFlatRepresentative(_provider: UsageProvider, _scanVersion: number, _generation: number, bucketStartMs: number): Promise<UsageHistorySample | null> {
    this.flatReads.push(bucketStartMs)
    return this.flats.get(bucketStartMs) ?? null
  }

  async writePage(input: BucketWritePageInput): Promise<void> {
    if (this.failPageAt !== null && this.pages.length + 1 === this.failPageAt) throw new Error('write failed')
    this.pages.push(input)
    this.checkpoints.set(input.provider, { lastProcessedId: input.lastProcessedId, stalledAtMs: null })
    for (const flat of input.flats) this.flats.set(flat.bucketStartMs, flat.event.sample)
  }

  async stall(current: UsageProvider, _scanVersion: number, _generation: number, at: number): Promise<void> {
    this.stalls.push({ provider: current, at })
    this.checkpoints.set(current, { lastProcessedId: this.checkpoints.get(current)?.lastProcessedId ?? '0', stalledAtMs: at })
  }
}

const run = (store: FakeBucketWriterStore, pageRows = 100) =>
  runBucketWriter(store, {
    scanVersion: USAGE_HISTORY_SCAN_VERSION,
    dataGeneration: 0,
    nowMs: T0 + 10 * 60_000,
    providers: [provider],
    pageRows,
  })

describe('Given the 15-minute bucket writer', () => {
  it('When there are no events Then it writes nothing and does not invent a checkpoint', async () => {
    const store = new FakeBucketWriterStore()
    await expect(run(store)).resolves.toEqual({ ok: true, value: { providers: 1, pages: 0, points: 0, flats: 0, stalled: 0 } })
    expect(store.pages).toEqual([])
    expect(store.checkpoints.size).toBe(0)
  })

  it('When events span pages Then each page advances the checkpoint and the final flat wins', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [1, 2, 3, 4, 5].map(index => event(sample(String(index), T0 + index * 60_000)))
    await expect(run(store, 2)).resolves.toMatchObject({ ok: true, value: { pages: 3, flats: 3 } })
    expect(store.pages.map(page => page.lastProcessedId)).toEqual(['2', '4', '5'])
    expect(store.checkpoints.get(provider)).toEqual({ lastProcessedId: '5', stalledAtMs: null })
    expect(store.flats.get(T0)?.id).toBe('5')
  })

  it('When a checkpoint exists Then it re-reads the last event and the flat representative before the next page', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [1, 2, 3, 4].map(index => event(sample(String(index), T0 + index * 60_000)))
    store.checkpoints.set(provider, { lastProcessedId: '2', stalledAtMs: null })
    store.flats.set(T0, sample('2', T0 + 120_000))
    await expect(run(store, 2)).resolves.toMatchObject({ ok: true, value: { pages: 1 } })
    expect(store.flatReads).toEqual([T0])
    expect(store.pages[0]?.lastProcessedId).toBe('4')
    expect(store.flats.get(T0)?.id).toBe('4')
  })

  it('When the checkpoint row is missing Then it writes a stall and does not advance', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [event(sample('1', T0))]
    store.checkpoints.set(provider, { lastProcessedId: '99', stalledAtMs: null })
    await expect(run(store)).resolves.toMatchObject({ ok: true, value: { pages: 0, stalled: 1 } })
    expect(store.pages).toEqual([])
    expect(store.stalls).toEqual([{ provider, at: T0 + 10 * 60_000 }])
  })

  it('When a provider is already stalled Then it skips it without re-scanning', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [event(sample('1', T0))]
    store.checkpoints.set(provider, { lastProcessedId: '1', stalledAtMs: T0 })
    await expect(run(store)).resolves.toMatchObject({ ok: true, value: { pages: 0, stalled: 1 } })
    expect(store.pages).toEqual([])
  })

  it('When a page write fails Then earlier pages stay and the result reports the failure', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [1, 2, 3, 4].map(index => event(sample(String(index), T0 + index * 60_000)))
    store.failPageAt = 2
    await expect(run(store, 2)).resolves.toEqual({ ok: false, reason: 'bucket_write_failed' })
    expect(store.pages).toHaveLength(1)
    expect(store.checkpoints.get(provider)?.lastProcessedId).toBe('2')
  })

  it('When an event is a failure or a value change Then the page contains the point and the flat separately', async () => {
    const store = new FakeBucketWriterStore()
    store.events = [
      event(sample('1', T0 + 60_000)),
      event(sample('2', T0 + 120_000, 10, { status: 'rate_limited', values: null })),
      event(sample('3', T0 + 180_000, 20)),
    ]
    await expect(run(store)).resolves.toMatchObject({ ok: true, value: { points: 1, flats: 1 } })
    expect(store.pages[0]?.points.map(item => item.sample.id)).toEqual(['2'])
    expect(store.pages[0]?.flats.map(item => item.event.sample.id)).toEqual(['3'])
  })
})
