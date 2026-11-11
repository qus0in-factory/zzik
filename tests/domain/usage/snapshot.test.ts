import { describe, expect, it } from 'vitest'
import { decodeUsageSnapshot } from '@domain/usage/snapshot'
import type { UsageProvider } from '@domain/usage/providers'

const snapshot = { schema: 1, provider: 'claude', status: 'ok', called: true, runAt: '2026-11-11T00:00:00Z', fetchedAt: null, httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 300, collectorVersion: '0.2.0', rawText: '{"five_hour":null}', rawOmitted: null }

const CLAUDE: UsageProvider = 'claude'

describe('Given an API snapshot envelope (ADR 0.3 D7)', () => {
  it('When a snapshot is absent Then all data is null', () => {
    expect(decodeUsageSnapshot({ snapshot: null }, CLAUDE)).toEqual({ ok: true, usage: null, collection: null, rawText: null })
  })

  it('When a valid envelope arrives Then usage and metadata are separated', () => {
    const { rawText, ...collection } = snapshot
    expect(decodeUsageSnapshot({ snapshot }, CLAUDE)).toEqual({ ok: true, usage: { five_hour: null }, rawText, collection })
  })

  it('When the envelope belongs to another provider Then it is rejected (제공자 혼입 방지)', () => {
    expect(decodeUsageSnapshot({ snapshot }, 'codex')).toMatchObject({ ok: false, message: 'invalid_response' })
    expect(decodeUsageSnapshot({ snapshot: { ...snapshot, provider: 'codex', rawText: '{"rate_limit":{}}' } }, 'codex')).toMatchObject({ ok: true })
  })

  it.each([{ schema: 2 }, { called: 'yes' }, { runAt: 'invalid' }, { intervalSec: 0 }, { status: 'unknown' }, { rawText: 42 }])('When fields are invalid %j Then it returns api_error', (override) => {
    expect(decodeUsageSnapshot({ snapshot: { ...snapshot, ...override } }, CLAUDE).ok).toBe(false)
  })

  it.each(['broken', '[]', 'null'])('When rawText is %s Then the original text is preserved', (rawText) => {
    const result = decodeUsageSnapshot({ snapshot: { ...snapshot, rawText } }, CLAUDE)
    expect(result.ok && result.usage).toBe(null)
    expect(result.ok && result.rawText).toBe(rawText)
  })

  it('When raw is omitted Then it preserves the omission reason', () => {
    const result = decodeUsageSnapshot({ snapshot: { ...snapshot, rawText: null, rawOmitted: 'too_large' } }, CLAUDE)
    expect(result.ok && result.collection?.rawOmitted).toBe('too_large')
  })

  it.each([null, {}, { snapshot: [] }])('When the response shape is invalid Then it returns api_error', (body) => {
    expect(decodeUsageSnapshot(body, CLAUDE).ok).toBe(false)
  })
})
