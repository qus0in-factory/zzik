import { describe, expect, it } from 'vitest'
import { restoreFromExportObjects } from '../../../../worker/app/usage/restore-d1-export'
import { buildExportDocument, serializeExportDocument } from '../../../../worker/domain/usage/export'
import type { ExportDocument, ExportEventRow } from '../../../../worker/domain/usage/export'
import { FakeExportObjectReader, FakeRestoreTarget } from '../../../fakes/export-ports'

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

const manifest = (eventHighWaterId: string) => ({
  eventHighWaterId,
  receiptCutMs: 1_001,
  dataGeneration: 0,
  exportedAtMs: Date.parse('2026-11-16T03:00:00.000Z'),
})

const document = (part: number, high: string, events: ExportEventRow[]): ExportDocument =>
  buildExportDocument({
    part,
    manifest: manifest(high),
    events,
    receipts: [{
      operationId: `op-${part}`,
      provider: 'codex',
      writeSeq: part,
      payloadSha256: 'a'.repeat(64),
      createdAtMs: 1_000,
    }],
  })

describe('Given R2 export objects and a scratch target', () => {
  it('When objects are restored in manifest order Then explicit ids, snapshots, receipts and the sequence fence are applied', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(document(1, '10', [event('9'), event('10')])))
    reader.objects.set('2026-11-16/part-0002.json', serializeExportDocument(document(2, '100', [event('100')])))
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({
      ok: true,
      value: { documents: 2, events: 3, receipts: 2, maxEventId: '100', nextIdFence: '1000100', requiresScanVersionBump: true },
    })
    expect([...target.events.keys()]).toEqual(['9', '10', '100'])
    expect(target.receipts.size).toBe(2)
    expect(target.fenced).toBe('1000100')
  })

  it('When the same objects are restored again Then duplicate rows are skipped and the result is unchanged', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(document(1, '10', [event('9'), event('10')])))
    const target = new FakeRestoreTarget()

    const first = await restoreFromExportObjects(reader, target)
    const second = await restoreFromExportObjects(reader, target)

    expect(first).toMatchObject({ ok: true, value: { events: 2 } })
    expect(second).toMatchObject({ ok: true, value: { events: 0 } })
    expect(target.events.size).toBe(2)
  })

  it('When an object is malformed Then the restore stops before writing any row', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', '{broken')
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({ ok: false, reason: 'invalid_export_object' })
    expect(target.events.size).toBe(0)
  })

  it('When an event id already exists with different content Then the restore fails instead of silently ignoring it', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(document(1, '10', [event('10')])))
    const target = new FakeRestoreTarget()
    target.events.set('10', event('10', { envelope: envelope({ intervalSec: 180 }) }))

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({ ok: false, reason: 'export_restore_conflict' })
  })

  it('When the bucket contains old and new generations Then only the newest generation is restored', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-15/part-0001.json', serializeExportDocument(buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '10', receiptCutMs: 0, dataGeneration: 0, exportedAtMs: NOW },
      events: [event('9'), event('10')],
    })))
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '20', receiptCutMs: 0, dataGeneration: 1, exportedAtMs: NOW },
      events: [event('20')],
    })))
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({ ok: true, value: { documents: 1, events: 1, maxEventId: '20' } })
    expect([...target.events.keys()]).toEqual(['20'])
  })

  it('When an explicit generation is absent Then the restore reports it without writing', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(document(1, '10', [event('10')])))
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target, { dataGeneration: 7 })

    expect(result).toMatchObject({ ok: false, reason: 'generation_not_found' })
    expect(target.events.size).toBe(0)
  })

  it('When documents share a high-water but have different exportedAt Then the newer document is applied last', async () => {
    const reader = new FakeExportObjectReader()
    const base = {
      provider: 'codex' as const,
      envelope: envelope(),
      status: 'ok' as const,
      runAtMs: 1_000,
      fetchedAtMs: 1_000,
      rawSha256: null,
      updatedAtMs: 1_000,
      writeSeq: 0,
      operationId: null,
    }
    const older = buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '10', receiptCutMs: 0, dataGeneration: 0, exportedAtMs: 2_000 },
      snapshots: [{ ...base, collectorVersion: 'old' }],
    })
    const newer = buildExportDocument({
      part: 1,
      manifest: { eventHighWaterId: '10', receiptCutMs: 0, dataGeneration: 0, exportedAtMs: 3_000 },
      snapshots: [{ ...base, collectorVersion: 'new' }],
    })
    // list() sorts keys ascending, so the newer date would otherwise be restored first.
    reader.objects.set('2026-11-17/part-0001.json', serializeExportDocument(older))
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(newer))
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({ ok: true, value: { documents: 2 } })
    expect(target.snapshotWrites.map(row => row.collectorVersion)).toEqual(['old', 'new'])
    expect(target.snapshots.get('codex')?.collectorVersion).toBe('new')
  })

  it('When the export contains only receipts and no events Then no sequence fence is applied', async () => {
    const reader = new FakeExportObjectReader()
    reader.objects.set('2026-11-16/part-0001.json', serializeExportDocument(buildExportDocument({
      part: 1,
      manifest: manifest('0'),
      events: [],
      receipts: [{ operationId: 'op-1', provider: 'codex', writeSeq: 1, payloadSha256: 'a'.repeat(64), createdAtMs: 1_000 }],
    })))
    const target = new FakeRestoreTarget()

    const result = await restoreFromExportObjects(reader, target)

    expect(result).toMatchObject({ ok: true, value: { events: 0, maxEventId: null, nextIdFence: null } })
    expect(target.fenced).toBeNull()
  })
})
