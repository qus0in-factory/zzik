import { describe, expect, it } from 'vitest'
import { scanCodexUsage } from '@domain/usage/codex-windows'
import codexNormalRaw from '../../fixtures/codex-usage.normal.json'
import codexUnknownRaw from '../../fixtures/codex-usage.unknown-keys.json'
import { NOW_ISO } from '../../fakes/usage-ports'

describe('Given the WHAM response shape from the research document', () => {
  it('When scanning the normal fixture then the two windows are found inside rate_limit', () => {
    const scan = scanCodexUsage(codexNormalRaw, { fetchedAt: NOW_ISO })
    expect(scan.windows.map((window) => window.path)).toEqual(['rate_limit.primary_window', 'rate_limit.secondary_window'])
    expect(scan.windows[0]).toMatchObject({
      insideRateLimit: true,
      usedPercent: 20,
      limitWindowSeconds: 18000,
      resetsAt: '2026-11-11T16:00:00.000Z',
    })
    expect(scan.windows[1]).toMatchObject({ usedPercent: 40, limitWindowSeconds: 604800, resetsAt: '2026-11-18T12:00:00.000Z' })
    expect(scan.issues).toEqual([])
  })

  it('When a window only has reset_after_seconds then the reset time is fetchedAt plus that offset', () => {
    const scan = scanCodexUsage(codexUnknownRaw, { fetchedAt: NOW_ISO })
    const secondary = scan.windows.find((window) => window.path === 'rate_limit.secondary_window')
    expect(secondary?.resetsAt).toBe('2026-11-11T12:30:00.000Z')
  })

  it('When a window sits outside rate_limit or inside an array then it is still found', () => {
    const scan = scanCodexUsage(codexUnknownRaw, { fetchedAt: NOW_ISO })
    expect(scan.windows.map((window) => window.path)).toContain('code_review_rate_limit')
    expect(scan.windows.map((window) => window.path)).toContain('mcp.buckets[0]')
    expect(scan.windows.find((window) => window.path === 'mcp.buckets[0]')?.insideRateLimit).toBe(false)
  })

  it('When used_percent is not a finite non-negative number then it is reported, not treated as a window', () => {
    const scan = scanCodexUsage(codexUnknownRaw, { fetchedAt: NOW_ISO })
    expect(scan.windows.map((window) => window.path)).not.toContain('broken_bucket')
    expect(scan.issues).toContainEqual({ code: 'invalid_utilization', key: 'broken_bucket' })
  })

  it('When a window object is found then its own fields are not scanned for nested windows', () => {
    const raw = { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000, nested: { used_percent: 99, limit_window_seconds: 18000 } } } }
    const scan = scanCodexUsage(raw, { fetchedAt: NOW_ISO })
    expect(scan.windows.map((window) => window.path)).toEqual(['rate_limit.primary_window'])
  })

  it('When an object needs a field that is missing then it is not a window', () => {
    const scan = scanCodexUsage({ daily: { used_percent: 10 } }, { fetchedAt: NOW_ISO })
    expect(scan.windows).toEqual([])
    expect(scan.otherEntries.map((entry) => entry.id)).toEqual(['daily'])
  })

  it('When the payload is not an object then the scan reports an invalid shape', () => {
    for (const raw of [null, [], 'text', 42]) {
      const scan = scanCodexUsage(raw, { fetchedAt: NOW_ISO })
      expect(scan.windows).toEqual([])
      expect(scan.otherEntries).toEqual([])
      expect(scan.issues).toEqual([{ code: 'invalid_shape', key: undefined }])
    }
  })

  it('When an object nests deeper than four levels then the window is out of scan range', () => {
    const raw = { a: { b: { c: { d: { e: { used_percent: 1, limit_window_seconds: 18000 } } } } } }
    expect(scanCodexUsage(raw, { fetchedAt: NOW_ISO }).windows).toEqual([])
  })
})

describe('Given the scan result for other items', () => {
  it('When a top level key holds windows then only its non-window fields become other items', () => {
    const scan = scanCodexUsage(codexUnknownRaw, { fetchedAt: NOW_ISO })
    const rateLimitOther = scan.otherEntries.find((entry) => entry.id === 'rate_limit')
    expect(rateLimitOther?.value).toEqual({
      kind: 'object',
      fields: [
        { key: 'limit_reached', text: 'false' },
        { key: 'unknown_field', text: 'kept-in-other-items' },
      ],
    })
  })

  it('When a top level key has no windows then the whole value becomes an other item', () => {
    const scan = scanCodexUsage(codexNormalRaw, { fetchedAt: NOW_ISO })
    expect(scan.otherEntries.map((entry) => entry.id)).toEqual(['plan', 'credits', 'rate_limit'])
    expect(scan.otherEntries[0].value).toEqual({ kind: 'value', text: 'pro' })
    expect(scan.otherEntries[1].value).toEqual({
      kind: 'object',
      fields: [
        { key: 'remaining', text: '1200' },
        { key: 'limit', text: '3000' },
      ],
    })
  })
})
