import { describe, expect, it } from 'vitest'
import { decodeHistoryBucketsPage, decodeHistoryPage, decodeHistorySummary } from '@domain/usage/history/decode-history'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'
import claude from '../../../fixtures/usage-history/claude.samples.json'
import emptyPage from '../../../fixtures/usage-history/empty-page.samples.json'

const page = () => structuredClone(claude) as Record<string, unknown>

describe('Given the history page decoder', () => {
  it('When the response is a valid fixture Then it decodes with all fields', () => {
    const result = decodeHistoryPage(claude, 'claude')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.page.samples.length).toBeGreaterThan(0)
      expect(result.page.samples[0].values?.[0]).toEqual(expect.objectContaining({ id: expect.any(String), usedPercent: expect.any(Number) }))
    }
  })
  it('When the page is empty Then it still decodes (nextCursor may be null)', () => {
    expect(decodeHistoryPage(emptyPage, (emptyPage as { provider: 'claude' }).provider).ok).toBe(true)
  })
  it('When scanVersion differs from this build Then api_error scan_version_mismatch (even if other fields are unknown)', () => {
    expect(decodeHistoryPage({ ...page(), scanVersion: USAGE_HISTORY_SCAN_VERSION + 1 }, 'claude')).toEqual({ ok: false, reason: 'api_error', message: 'scan_version_mismatch' })
    expect(decodeHistoryPage({ scanVersion: 99, whatever: true }, 'claude')).toEqual({ ok: false, reason: 'api_error', message: 'scan_version_mismatch' })
  })
  it('When the provider does not match the request Then invalid_response', () => {
    expect(decodeHistoryPage(claude, 'codex')).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
  it.each([
    ['not an object', null],
    ['array', []],
    ['samples not an array', { ...page(), samples: 'x' }],
    ['hasMore not boolean', { ...page(), hasMore: 'yes' }],
    ['nextCursor not string|null', { ...page(), nextCursor: 5 }],
    ['sample id not a string', (() => { const p = page(); (p.samples as Record<string, unknown>[])[0].id = 9; return p })()],
    ['sample status unknown', (() => { const p = page(); (p.samples as Record<string, unknown>[])[0].status = 'weird'; return p })()],
    ['sample runAt not a time', (() => { const p = page(); (p.samples as Record<string, unknown>[])[0].runAt = 'nope'; return p })()],
    ['value usedPercent not finite', (() => { const p = page(); ((p.samples as { values: Record<string, unknown>[] }[])[0].values[0]).usedPercent = 'x'; return p })()],
    ['values neither array nor null', (() => { const p = page(); (p.samples as Record<string, unknown>[])[0].values = {}; return p })()],
    ['anchor malformed', { ...page(), anchor: { id: 1 } }],
  ])('When %s Then invalid_response', (_name, raw) => {
    expect(decodeHistoryPage(raw, 'claude')).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
  it('When the response carries extra keys (rawText, rawRedacted, anything) Then they are dropped (원문은 어디에도 남지 않는다)', () => {
    const p = page()
    ;(p.samples as Record<string, unknown>[])[0].rawText = '{"secret":1}'
    ;(p.samples as Record<string, unknown>[])[0].rawRedacted = ['a']
    p.extra = 1
    const result = decodeHistoryPage(p, 'claude')
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(JSON.stringify(result)).not.toContain('rawRedacted')
    expect(JSON.stringify(result)).not.toContain('"extra"')
  })
  it('When values is null or an empty array Then both are kept distinct', () => {
    const p = page()
    ;(p.samples as Record<string, unknown>[])[0].values = null
    ;(p.samples as Record<string, unknown>[])[1].values = []
    const result = decodeHistoryPage(p, 'claude')
    if (!result.ok) throw new Error('expected ok')
    expect(result.page.samples[0].values).toBeNull()
    expect(result.page.samples[1].values).toEqual([])
  })
})

describe('Given the history summary decoder', () => {
  const ok = { summary: ['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'].map((provider) => ({ provider, okCount: 4, firstOkAt: '2026-11-10T00:00:00.000Z', lastOkAt: '2026-11-14T00:00:00.000Z' })) }
  it('When valid Then it decodes entries in the given order', () => {
    const result = decodeHistorySummary(ok)
    expect(result.ok && result.summary.map((entry) => entry.provider)).toEqual(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'])
  })
  it('When an entry is malformed or the provider is unknown Then invalid_response', () => {
    expect(decodeHistorySummary({ summary: [{ provider: 'nope', okCount: 1, firstOkAt: null, lastOkAt: null }] })).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
    expect(decodeHistorySummary({ summary: [{ provider: 'claude', okCount: 'x', firstOkAt: null, lastOkAt: null }] })).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
    expect(decodeHistorySummary(null)).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
})


describe('Given the 30-day bucket decoder', () => {
  const sample = { id: 'flat:1', runAt: '2026-11-01T00:15:00.000Z', status: 'ok', fetchedAt: '2026-11-01T00:15:00.000Z', intervalSec: 900, values: [{ id: 'five_hour', usedPercent: 12, resetsAt: null, cycleSeconds: null }] }
  const bucket = { provider: 'claude', scanVersion: USAGE_HISTORY_SCAN_VERSION, bucketSec: 900, from: '2026-11-01T00:00:00.000Z', until: '2026-11-16T00:00:00.000Z', samples: [sample], anchor: null, complete: true }
  it('When the bucket response is valid Then it decodes fields only', () => {
    const result = decodeHistoryBucketsPage({ ...bucket, rawText: 'secret' }, 'claude')
    if (!result.ok) throw new Error('expected ok')
    expect(result.page).toMatchObject({ provider: 'claude', bucketSec: 900, complete: true, from: bucket.from, until: bucket.until })
    expect(result.page.samples[0]?.id).toBe('flat:1')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('When scanVersion differs Then scan_version_mismatch', () => {
    expect(decodeHistoryBucketsPage({ ...bucket, scanVersion: 99 }, 'claude')).toEqual({ ok: false, reason: 'api_error', message: 'scan_version_mismatch' })
  })
  it.each([
    ['provider', { ...bucket, provider: 'codex' }],
    ['bucketSec', { ...bucket, bucketSec: 901 }],
    ['complete', { ...bucket, complete: 'yes' }],
    ['from', { ...bucket, from: 'nope' }],
    ['until before from', { ...bucket, until: '2026-10-01T00:00:00.000Z' }],
    ['samples', { ...bucket, samples: 'x' }],
    ['anchor', { ...bucket, anchor: { id: 1 } }],
  ])('When %s is invalid Then invalid_response', (_name, raw) => {
    expect(decodeHistoryBucketsPage(raw, 'claude')).toEqual({ ok: false, reason: 'api_error', message: 'invalid_response' })
  })
})
