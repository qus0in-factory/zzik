import { describe, expect, it } from 'vitest'
import {
  BUCKET_CRON,
  EXPORT_CRON,
  EXPORT_PART_MAX_BYTES,
  buildExportDocument,
  chunkRowsByEncodedBytes,
  classifyScheduledCron,
  compareDecimalIds,
  exportObjectKey,
  jsonByteLength,
  parseDataGeneration,
  parseExportDocument,
  partNumberFromObjectKey,
  restoreFenceNextId,
  serializeExportDocument,
  trimRowsByEnvelopeBytes,
} from '../../../../worker/domain/usage/export'
import type { ExportDocument, ExportEventRow } from '../../../../worker/domain/usage/export'

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

const manifest = (eventHighWaterId: string, overrides: Partial<ExportDocument['manifest']> = {}) => ({
  eventHighWaterId,
  receiptCutMs: 0,
  dataGeneration: 0,
  exportedAtMs: Date.parse('2026-11-16T03:00:00.000Z'),
  ...overrides,
})

describe('Given a scheduled cron string', () => {
  it.each([
    [EXPORT_CRON, 'export'],
    [BUCKET_CRON, 'bucket'],
    ['0 * * * *', 'unknown'],
    [undefined, 'unknown'],
  ] as const)('When cron is %s Then it is classified as %s', (cron, kind) => {
    expect(classifyScheduledCron(cron)).toBe(kind)
  })
})

describe('Given export object keys', () => {
  it('When a part is named Then the key contains only the UTC date and padded part number', () => {
    expect(exportObjectKey(Date.parse('2026-11-16T03:00:00.000Z'), 1)).toBe('2026-11-16/part-0001.json')
    expect(exportObjectKey(Date.parse('2026-11-16T23:59:59.999Z'), 42)).toBe('2026-11-16/part-0042.json')
    expect(partNumberFromObjectKey('2026-11-16/part-0042.json')).toBe(42)
    expect(partNumberFromObjectKey('2026-11-16/other.json')).toBeNull()
  })
})

describe('Given an export page near the 4MB body limit', () => {
  it('When the next row would cross the limit Then the page is cut at the previous row and keeps at least one row', () => {
    const rows = [event('1', { envelope: 'x'.repeat(6) }), event('2', { envelope: 'y'.repeat(6) }), event('3', { envelope: 'z'.repeat(6) })]
    expect(trimRowsByEnvelopeBytes(rows, 5).map(row => row.id)).toEqual(['1'])
    expect(trimRowsByEnvelopeBytes(rows, 10).map(row => row.id)).toEqual(['1', '2'])
    expect(trimRowsByEnvelopeBytes([], 10)).toEqual([])
  })

  it('When rows are chunked for a part Then each chunk serializes under the budget unless it holds a single row', () => {
    const rows = Array.from({ length: 5 }, (_, index) => event(String(index + 1), { envelope: 'x'.repeat(50) }))
    const chunks = chunkRowsByEncodedBytes(rows, 120)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flat().map(row => row.id)).toEqual(['1', '2', '3', '4', '5'])
    for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0)
  })

  it('When the part budget is the documented 5MiB Then a normal JSON document fits', () => {
    const doc = buildExportDocument({ part: 1, manifest: manifest('1'), events: [event('1')] })
    expect(jsonByteLength(serializeExportDocument(doc))).toBeLessThan(EXPORT_PART_MAX_BYTES)
  })
})

describe('Given decimal event ids', () => {
  it('When ids have different digit lengths Then comparison is numeric and does not use Number', () => {
    const ids = ['100', '9223372036854775807', '9', '10']
    expect([...ids].sort(compareDecimalIds)).toEqual(['9', '10', '100', '9223372036854775807'])
    expect(compareDecimalIds('0', '0')).toBe(0)
  })

  it('When a restore fence is computed Then it is the maximum id plus the fixed margin', () => {
    expect(restoreFenceNextId('100')).toBe('1000100')
    expect(restoreFenceNextId('100', 10)).toBe('110')
    expect(restoreFenceNextId('9223372036854775807')).toBe('9223372036854775807')
  })
})

describe('Given a data generation setting', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['0', 0],
    ['7', 7],
  ] as const)('When the value is %s Then it parses to %s', (value, expected) => {
    expect(parseDataGeneration(value)).toBe(expected)
  })

  it.each(['-1', '1.5', 'abc', '9007199254740992'])('When the value is %s Then it is rejected', (value) => {
    expect(parseDataGeneration(value)).toBeNull()
  })
})

describe('Given an exported document', () => {
  it('When the manifest and rows are valid Then it round-trips through JSON', () => {
    const doc = buildExportDocument({
      part: 1,
      manifest: manifest('10', { receiptCutMs: 1_001 }),
      events: [event('9'), event('10')],
      snapshots: [{
        provider: 'codex', envelope: envelope(), status: 'ok', runAtMs: 1_000, fetchedAtMs: 1_000,
        rawSha256: null, collectorVersion: '0.6.20', updatedAtMs: 1_000, writeSeq: 0, operationId: null,
      }],
      receipts: [{
        operationId: '11111111-1111-4111-8111-111111111111', provider: 'codex', writeSeq: 1,
        payloadSha256: 'a'.repeat(64), createdAtMs: 1_000,
      }],
    })
    const parsed = parseExportDocument(serializeExportDocument(doc))
    expect(parsed).toEqual({ ok: true, value: doc })
  })

  it.each([
    ['version', (doc: ExportDocument) => ({ ...doc, version: 2 })],
    ['part', (doc: ExportDocument) => ({ ...doc, part: 0 })],
    ['high-water id', (doc: ExportDocument) => ({ ...doc, manifest: { ...doc.manifest, eventHighWaterId: '01' } })],
    ['negative receipt cut', (doc: ExportDocument) => ({ ...doc, manifest: { ...doc.manifest, receiptCutMs: -1 } })],
    ['non-object envelope', (doc: ExportDocument) => ({ ...doc, events: [{ ...doc.events[0]!, envelope: '[]' }] })],
    ['last id mismatch', (doc: ExportDocument) => ({ ...doc, manifest: { ...doc.manifest, eventHighWaterId: '9' } })],
    ['descending ids', (doc: ExportDocument) => ({ ...doc, events: [event('10'), event('9')], manifest: manifest('9') })],
  ])('When %s is invalid Then parsing fails without throwing', (_name, mutate) => {
    const doc = buildExportDocument({ part: 1, manifest: manifest('10'), events: [event('9'), event('10')] })
    expect(() => parseExportDocument(JSON.stringify(mutate(doc)))).not.toThrow()
    expect(parseExportDocument(JSON.stringify(mutate(doc)))).toEqual({ ok: false, reason: 'invalid_export_object' })
  })
})
