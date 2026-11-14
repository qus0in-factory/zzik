import { describe, expect, it } from 'vitest'
import {
  USAGE_HISTORY_ANCHOR_ON,
  USAGE_HISTORY_CURSOR_RE,
  USAGE_HISTORY_ERROR_STATUS,
  USAGE_HISTORY_INSTANT_RE,
  USAGE_HISTORY_LIMIT_MAX,
  USAGE_HISTORY_LIMIT_RE,
  USAGE_HISTORY_MIN_OK_EVENTS,
  USAGE_HISTORY_PAGE_LIMIT,
  USAGE_HISTORY_PATH,
  USAGE_HISTORY_SCAN_VERSION,
  type UsageHistoryPage,
  type UsageHistorySample,
  type UsageHistoryValue,
} from '../../shared/usage-history-contract'
import { USAGE_PROVIDERS, type UsageProvider, type UsageStatus } from '../../shared/usage-contract'
import claudeFixture from '../fixtures/usage-history/claude.samples.json'
import codexFixture from '../fixtures/usage-history/codex.samples.json'
import antigravityFixture from '../fixtures/usage-history/antigravity.samples.json'
import opencodeFixture from '../fixtures/usage-history/opencode.samples.json'
import grokFixture from '../fixtures/usage-history/grok.samples.json'
import ollamaFixture from '../fixtures/usage-history/ollama.samples.json'
import gapFixture from '../fixtures/usage-history/gap.samples.json'
import emptyPageFixture from '../fixtures/usage-history/empty-page.samples.json'
import hasMoreFixture from '../fixtures/usage-history/has-more.samples.json'

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const STATUSES: readonly UsageStatus[] = [
  'ok',
  'rate_limited',
  'token_expired',
  'auth_required',
  'auth_rejected',
  'no_credentials',
  'upstream_error',
  'network_error',
]
const FORBIDDEN_KEYS = ['rawText', 'rawRedacted', 'envelope', 'others', 'kvTokenExpiresAt']

const FIXTURES: { provider: UsageProvider; value: unknown }[] = [
  { provider: 'claude', value: claudeFixture },
  { provider: 'codex', value: codexFixture },
  { provider: 'antigravity', value: antigravityFixture },
  { provider: 'opencode', value: opencodeFixture },
  { provider: 'grok', value: grokFixture },
  { provider: 'ollama', value: ollamaFixture },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectKeys(value: Record<string, unknown>, keys: readonly string[]) {
  expect(Object.keys(value).sort()).toEqual([...keys].sort())
}

function isValidIso(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value))
}

function asValue(value: unknown): UsageHistoryValue {
  if (!isRecord(value)) throw new Error('value가 객체가 아니다')
  expectKeys(value, ['id', 'usedPercent', 'resetsAt', 'cycleSeconds'])
  expect(typeof value.id).toBe('string')
  expect(typeof value.usedPercent).toBe('number')
  expect(Number.isFinite(value.usedPercent as number)).toBe(true)
  expect(value.usedPercent as number).toBeGreaterThanOrEqual(0)
  if (value.resetsAt !== null) expect(isValidIso(value.resetsAt)).toBe(true)
  if (value.cycleSeconds !== null) {
    expect(typeof value.cycleSeconds).toBe('number')
    expect(value.cycleSeconds as number).toBeGreaterThan(0)
  }
  return value as unknown as UsageHistoryValue
}

function asSample(value: unknown): UsageHistorySample {
  if (!isRecord(value)) throw new Error('sample이 객체가 아니다')
  expectKeys(value, ['id', 'runAt', 'status', 'fetchedAt', 'intervalSec', 'values'])
  expect(String(value.id)).toMatch(/^\d+$/)
  expect(isValidIso(value.runAt)).toBe(true)
  expect(STATUSES).toContain(value.status as UsageStatus)
  if (value.fetchedAt !== null) expect(isValidIso(value.fetchedAt)).toBe(true)
  if (value.intervalSec !== null) {
    expect(typeof value.intervalSec).toBe('number')
    expect(value.intervalSec as number).toBeGreaterThan(0)
  }
  if (value.values !== null) {
    expect(Array.isArray(value.values)).toBe(true)
    for (const item of value.values as unknown[]) asValue(item)
  }
  // ok 표본은 값 확인 시각이 실행 시각과 같고, 실패 표본은 값이 없다(4.4절).
  if (value.status === 'ok') expect(value.fetchedAt).toBe(value.runAt)
  else expect(value.values).toBeNull()
  return value as unknown as UsageHistorySample
}

function asPage(value: unknown, expectedProvider: UsageProvider): UsageHistoryPage {
  if (!isRecord(value)) throw new Error('page가 객체가 아니다')
  expectKeys(value, ['provider', 'scanVersion', 'samples', 'anchor', 'nextCursor', 'hasMore'])
  expect(value.provider).toBe(expectedProvider)
  expect(value.scanVersion).toBe(USAGE_HISTORY_SCAN_VERSION)
  expect(Array.isArray(value.samples)).toBe(true)
  const samples = (value.samples as unknown[]).map(asSample)
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]
    const next = samples[i]
    const order = Date.parse(next.runAt) - Date.parse(prev.runAt)
    expect(order > 0 || (order === 0 && BigInt(next.id) > BigInt(prev.id))).toBe(true)
  }
  if (value.anchor !== null) {
    const anchor = asSample(value.anchor)
    expect(anchor.status).toBe('ok')
    if (samples.length > 0) expect(Date.parse(anchor.runAt)).toBeLessThan(Date.parse(samples[0].runAt))
  }
  if (samples.length > 0) {
    const last = samples[samples.length - 1]
    expect(value.nextCursor).toBe(`${last.runAt}_${last.id}`)
  } else {
    // 픽스처는 after 없이 요청된 빈 쪽이므로 nextCursor가 null이다(ADR 4.2절).
    expect(value.nextCursor).toBeNull()
  }
  return value as unknown as UsageHistoryPage
}

function walkKeys(value: unknown, visit: (key: string) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit)
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      visit(key)
      walkKeys(child, visit)
    }
  }
}

describe('Given the frozen usage history contract (ADR 0.7 T0)', () => {
  it('When reading the constants Then the agreed shape and page limits are frozen', () => {
    expect(USAGE_HISTORY_PATH).toBe('/api/usage-history')
    expect(USAGE_HISTORY_LIMIT_MAX).toBe(100)
    expect(USAGE_HISTORY_PAGE_LIMIT).toBe(50)
    expect(USAGE_HISTORY_MIN_OK_EVENTS).toBe(2)
    expect(USAGE_HISTORY_SCAN_VERSION).toBe(2)
    expect(USAGE_HISTORY_ANCHOR_ON).toBe('1')
  })

  it('When validating query formats Then the instant, cursor and limit regexes accept and reject the ADR examples', () => {
    expect(USAGE_HISTORY_INSTANT_RE.test('2026-11-14T00:00:00Z')).toBe(true)
    expect(USAGE_HISTORY_INSTANT_RE.test('2026-11-14T00:00:00.5Z')).toBe(true)
    expect(USAGE_HISTORY_INSTANT_RE.test('2026-11-14T00:00:00.123Z')).toBe(true)
    expect(USAGE_HISTORY_INSTANT_RE.test('2026-11-14')).toBe(false)
    expect(USAGE_HISTORY_INSTANT_RE.test('2026-11-14T00:00:00+09:00')).toBe(false)
    expect(USAGE_HISTORY_INSTANT_RE.test('')).toBe(false)

    expect(USAGE_HISTORY_CURSOR_RE.test('2026-11-14T00:00:00.000Z_12')).toBe(true)
    expect(USAGE_HISTORY_CURSOR_RE.test('2026-11-14T00:00:00Z_12')).toBe(false)
    expect(USAGE_HISTORY_CURSOR_RE.test('2026-11-14T00:00:00.000Z_0')).toBe(false)
    expect(USAGE_HISTORY_CURSOR_RE.test('2026-11-14T00:00:00.000Z')).toBe(false)

    expect(USAGE_HISTORY_LIMIT_RE.test('1')).toBe(true)
    expect(USAGE_HISTORY_LIMIT_RE.test('100')).toBe(true)
    expect(USAGE_HISTORY_LIMIT_RE.test('0')).toBe(false)
    expect(USAGE_HISTORY_LIMIT_RE.test('050')).toBe(false)
    expect(USAGE_HISTORY_LIMIT_RE.test('1.5')).toBe(false)
  })

  it('When mapping history errors Then the contract carries the eight status codes and their order', () => {
    expect(Object.keys(USAGE_HISTORY_ERROR_STATUS).sort()).toEqual([
      'internal_error',
      'invalid_query',
      'jwks_unavailable',
      'method_not_allowed',
      'misconfigured',
      'not_found',
      'storage_unavailable',
      'unauthorized',
    ])
    expect(USAGE_HISTORY_ERROR_STATUS).toMatchObject({
      misconfigured: 500,
      unauthorized: 401,
      jwks_unavailable: 503,
      not_found: 404,
      method_not_allowed: 405,
      invalid_query: 400,
      storage_unavailable: 503,
      internal_error: 500,
    })
  })

  it('When loading the synthetic samples Then all six providers satisfy the contract', () => {
    expect(FIXTURES.map((fixture) => fixture.provider).sort()).toEqual([...USAGE_PROVIDERS].sort())
    for (const fixture of FIXTURES) {
      const page = asPage(fixture.value, fixture.provider)
      expect(page.samples.length).toBeGreaterThan(0)
    }
  })

  it('When serializing the fixtures Then no provider raw text or envelope keys are present', () => {
    const keys: string[] = []
    for (const fixture of FIXTURES) walkKeys(fixture.value, (key) => keys.push(key))
    for (const forbidden of FORBIDDEN_KEYS) expect(keys).not.toContain(forbidden)
  })

  it('When inspecting values Then null (unknown) and [] (series disappeared) both appear and stay distinct', () => {
    const all = FIXTURES.flatMap((fixture) => asPage(fixture.value, fixture.provider).samples)
    expect(all.some((sample) => sample.values === null)).toBe(true)
    expect(all.some((sample) => Array.isArray(sample.values) && sample.values.length === 0)).toBe(true)
    for (const sample of all) expect(sample.values === null || Array.isArray(sample.values)).toBe(true)
  })

  it('When a sample fails Then values is null and fetchedAt keeps the last successful confirmation time', () => {
    for (const fixture of FIXTURES) {
      const page = asPage(fixture.value, fixture.provider)
      for (let i = 0; i < page.samples.length; i += 1) {
        const sample = page.samples[i]
        if (sample.status === 'ok') continue
        const previousOk = page.samples.slice(0, i).reverse().find((candidate) => candidate.status === 'ok')
        expect(sample.values).toBeNull()
        expect(sample.fetchedAt).toBe(previousOk?.fetchedAt ?? null)
      }
    }
  })

  it('When a limit resets Then the fixtures carry the reset boundary (drop after resetsAt)', () => {
    const boundaries: string[] = []
    for (const fixture of FIXTURES) {
      const samples = asPage(fixture.value, fixture.provider).samples.filter(
        (sample): sample is UsageHistorySample & { values: UsageHistoryValue[] } => Array.isArray(sample.values),
      )
      for (let i = 1; i < samples.length; i += 1) {
        const before = new Map(samples[i - 1].values.map((value) => [value.id, value]))
        for (const value of samples[i].values) {
          const previous = before.get(value.id)
          if (previous === undefined || previous.resetsAt === null) continue
          const pastReset = Date.parse(samples[i].runAt) >= Date.parse(previous.resetsAt) - 60_000
          if (pastReset && value.usedPercent < previous.usedPercent) boundaries.push(`${fixture.provider}:${value.id}`)
        }
      }
    }
    expect(boundaries.length).toBeGreaterThan(0)
  })

  it('When a series disappears Then some sample omits a previously present series', () => {
    let disappeared = false
    for (const fixture of FIXTURES) {
      const samples = asPage(fixture.value, fixture.provider).samples.filter(
        (sample): sample is UsageHistorySample & { values: UsageHistoryValue[] } => Array.isArray(sample.values),
      )
      for (let i = 1; i < samples.length && !disappeared; i += 1) {
        const now = new Set(samples[i].values.map((value) => value.id))
        if (samples[i - 1].values.some((value) => !now.has(value.id))) disappeared = true
      }
    }
    expect(disappeared).toBe(true)
  })

  it('When the anchor exists Then it is an ok sample just before the page range', () => {
    const withAnchor = FIXTURES.map((fixture) => asPage(fixture.value, fixture.provider)).filter(
      (page) => page.anchor !== null,
    )
    expect(withAnchor.length).toBeGreaterThan(0)
    for (const page of withAnchor) {
      expect(page.anchor?.status).toBe('ok')
      expect(Date.parse(page.anchor!.runAt)).toBeLessThan(Date.parse(page.samples[0].runAt))
    }
  })

  it('When an ok sample has no intervalSec Then the gap page stays valid and keeps the null interval', () => {
    const page = asPage(gapFixture, 'claude')
    expect(page.samples).toHaveLength(2)
    expect(page.samples[0].intervalSec).toBe(900)
    expect(page.samples[1].status).toBe('ok')
    expect(page.samples[1].intervalSec).toBeNull()
    const gapMs = Date.parse(page.samples[1].runAt) - Date.parse(page.samples[0].runAt)
    expect(gapMs).toBeGreaterThan(1.5 * (page.samples[0].intervalSec ?? 0) * 1000)
    expect(page.hasMore).toBe(false)
  })

  it('When a page is empty Then no samples, a null cursor and hasMore false are allowed', () => {
    const page = asPage(emptyPageFixture, 'claude')
    expect(page.samples).toEqual([])
    expect(page.nextCursor).toBeNull()
    expect(page.hasMore).toBe(false)
  })

  it('When a page has more Then nextCursor is present so the client can continue', () => {
    const page = asPage(hasMoreFixture, 'claude')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toBe(`${page.samples.at(-1)!.runAt}_${page.samples.at(-1)!.id}`)
  })
})
