import { describe, expect, it } from 'vitest'
import { runD1Export, runScheduledExport } from '../../../../worker/app/usage/export-d1'
import { EXPORT_CRON, buildExportDocument, serializeExportDocument } from '../../../../worker/domain/usage/export'
import type { ExportEventRow, ExportLogRow, ExportReceiptRow, ExportSnapshotRow } from '../../../../worker/domain/usage/export'
import { FakeExportSink, FakeExportSource } from '../../../fakes/export-ports'

const NOW = Date.parse('2026-11-16T03:00:00.000Z')

const envelope = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
  schema: 1,
  provider: 'codex',
  status: 'ok',
  called: true,
  runAt: '2026-11-16T00:00:00.000Z',
  fetchedAt: '2026-11-16T00:00:00.000Z',
  httpStatus: 200,
  retryAt: null,
  tokenExpiresAt: null,
  kvTokenExpiresAt: null,
  intervalSec: 900,
  collectorVersion: '0.6.20',
  rawText: null,
  rawOmitted: null,
  rawRedacted: [],
  ...overrides,
})

const event = (id: string, overrides: Partial<ExportEventRow> = {}): ExportEventRow => ({
  id,
  provider: 'codex',
  runAtMs: 1_000,
  status: 'ok',
  rawSha256: null,
  envelope: envelope(),
  operationId: null,
  ...overrides,
})

const snapshot = (provider: 'codex' | 'claude'): ExportSnapshotRow => ({
  provider,
  envelope: envelope({ provider }),
  status: 'ok',
  runAtMs: 1_000,
  fetchedAtMs: 1_000,
  rawSha256: null,
  collectorVersion: '0.6.20',
  updatedAtMs: 1_000,
  writeSeq: 0,
  operationId: null,
})

const receipt = (operationId: string, createdAtMs: number): ExportReceiptRow => ({
  operationId,
  provider: 'codex',
  writeSeq: 1,
  payloadSha256: 'a'.repeat(64),
  createdAtMs,
})

const log = (high: string, cut = 0, generation = 0): ExportLogRow => ({
  ranAtMs: NOW - 86_400_000,
  objectKey: '2026-11-15/part-0001.json',
  eventHighWaterId: high,
  receiptCutMs: cut,
  dataGeneration: generation,
  bytes: 10,
  ok: 1,
})

describe('Given a D1 export run', () => {
  it('When events span several pages Then each page is a part and the high-water advances monotonically', async () => {
    const source = new FakeExportSource()
    source.events = [event('9'), event('10'), event('100')]
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0, eventPageMaxRows: 2 })

    expect(result).toMatchObject({ ok: true, value: { parts: 2, eventHighWaterId: '100' } })
    expect(sink.puts.map(put => put.key)).toEqual(['2026-11-16/part-0001.json', '2026-11-16/part-0002.json'])
    const first = JSON.parse(sink.puts[0]!.body) as { manifest: { eventHighWaterId: string }; events: Array<{ id: string }> }
    const second = JSON.parse(sink.puts[1]!.body) as { manifest: { eventHighWaterId: string }; events: Array<{ id: string }> }
    expect(first.events.map(row => row.id)).toEqual(['9', '10'])
    expect(first.manifest.eventHighWaterId).toBe('10')
    expect(second.events.map(row => row.id)).toEqual(['100'])
    expect(second.manifest.eventHighWaterId).toBe('100')
    expect(source.logs.map(row => row.ok)).toEqual([1, 1])
    expect(source.logs.map(row => row.eventHighWaterId)).toEqual(['10', '100'])
  })

  it('When the generation changed Then the high-water starts at zero instead of continuing the old generation', async () => {
    const source = new FakeExportSource()
    source.events = [event('9'), event('10')]
    source.lastLogs.set(1, log('100', 5_000, 1))
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 2 })

    expect(result).toMatchObject({ ok: true })
    expect(source.eventPageCalls[0]?.afterId).toBe('0')
    expect(source.logs[0]).toMatchObject({ dataGeneration: 2, eventHighWaterId: '10' })
  })

  it('When snapshots and receipts are present Then they are exported after the events and the receipt cut advances', async () => {
    const source = new FakeExportSource()
    source.events = [event('10')]
    source.snapshots = [snapshot('claude'), snapshot('codex')]
    source.receipts = [receipt('op-1', 1_000), receipt('op-2', 2_000)]
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0, receiptPageMaxRows: 10 })

    expect(result).toMatchObject({ ok: true, value: { parts: 3, eventHighWaterId: '10', receiptCutMs: 2_001 } })
    const documents = sink.puts.map(put => JSON.parse(put.body) as { snapshots: unknown[]; receipts: unknown[]; manifest: { receiptCutMs: number } })
    expect(documents[1]!.snapshots).toHaveLength(2)
    expect(documents[2]!.receipts).toHaveLength(2)
    expect(documents[2]!.manifest.receiptCutMs).toBe(2_001)
  })

  it('When a receipt page ends in the middle of one millisecond Then the cut never skips the remaining rows', async () => {
    const source = new FakeExportSource()
    source.receipts = [receipt('op-1', 1_000), receipt('op-2', 1_000), receipt('op-3', 1_001)]
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0, receiptPageMaxRows: 1 })

    expect(result).toMatchObject({ ok: true })
    const documents = sink.puts.map(put => JSON.parse(put.body) as { receipts: Array<{ operationId: string }> })
    expect(documents.flatMap(doc => doc.receipts.map(row => row.operationId))).toEqual(['op-1', 'op-2', 'op-3'])
    expect(source.logs.at(-1)?.receiptCutMs).toBe(1_002)
  })

  it('When no rows exist Then a manifest-only heartbeat object is still written and logged', async () => {
    const source = new FakeExportSource()
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0 })

    expect(result).toMatchObject({ ok: true, value: { parts: 1, eventHighWaterId: '0' } })
    const doc = JSON.parse(sink.puts[0]!.body) as { manifest: { eventHighWaterId: string }; events: unknown[] }
    expect(doc.manifest.eventHighWaterId).toBe('0')
    expect(doc.events).toEqual([])
    expect(source.logs).toHaveLength(1)
  })

  it('When a part exceeds the part budget Then it is split at event boundaries', async () => {
    const source = new FakeExportSource()
    source.events = [event('1', { envelope: envelope({ rawText: 'x'.repeat(200) }) }), event('2', { envelope: envelope({ rawText: 'y'.repeat(200) }) }), event('3', { envelope: envelope({ rawText: 'z'.repeat(200) }) })]
    const sink = new FakeExportSink()
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0, partMaxBytes: 1200 })

    expect(result).toMatchObject({ ok: true })
    expect(sink.puts.length).toBeGreaterThan(1)
    expect(sink.puts.flatMap(put => (JSON.parse(put.body) as { events: Array<{ id: string }> }).events.map(row => row.id))).toEqual(['1', '2', '3'])
  })

  it('When the object write fails Then the successful parts stay logged and no new high-water is committed for the failed part', async () => {
    const source = new FakeExportSource()
    source.events = [event('1'), event('2'), event('3')]
    const sink = new FakeExportSink()
    sink.failAt = 2
    const result = await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0, eventPageMaxRows: 1 })

    expect(result).toEqual({ ok: false, reason: 'export_write_failed' })
    expect(source.logs.map(row => row.ok)).toEqual([1, 0])
    expect(source.lastLogs.get(0)?.eventHighWaterId).toBe('1')
  })

  it('When an existing date already has parts Then the next run continues the part numbers instead of overwriting', async () => {
    const source = new FakeExportSource()
    source.events = [event('10')]
    source.lastParts.set('2026-11-16', 3)
    const sink = new FakeExportSink()
    await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0 })
    expect(sink.puts[0]?.key).toBe('2026-11-16/part-0004.json')
  })

  it('When the exported object is restored from the same bytes Then the manifest and rows survive', async () => {
    const source = new FakeExportSource()
    source.events = [event('10')]
    source.snapshots = [snapshot('codex')]
    const sink = new FakeExportSink()
    await runD1Export({ source, sink, nowMs: NOW, dataGeneration: 0 })
    for (const put of sink.puts) {
      const parsed = JSON.parse(put.body)
      expect(serializeExportDocument(buildExportDocument(parsed))).toBe(put.body)
    }
  })
})

describe('Given a scheduled event', () => {
  it.each([
    ['not_export', { cron: '0 * * * *', source: null, sink: null, nowMs: NOW, dataGeneration: undefined }],
    ['missing_bindings', { cron: EXPORT_CRON, source: null, sink: null, nowMs: NOW, dataGeneration: undefined }],
    ['invalid_data_generation', { cron: EXPORT_CRON, source: null, sink: null, nowMs: NOW, dataGeneration: 'abc' }],
  ] as const)('When the event is %s Then it finishes safely without writing', async (reason, input) => {
    await expect(runScheduledExport(input)).resolves.toEqual({ ok: true, kind: 'skipped', reason })
  })

  it('When the export cron and bindings are present Then it writes an object and logs the run', async () => {
    const source = new FakeExportSource()
    source.events = [event('10')]
    const sink = new FakeExportSink()
    const result = await runScheduledExport({ cron: EXPORT_CRON, source, sink, nowMs: NOW, dataGeneration: '0' })
    expect(result).toMatchObject({ ok: true, kind: 'exported', parts: 1 })
    expect(sink.puts).toHaveLength(1)
    expect(source.logs).toHaveLength(1)
  })
})
