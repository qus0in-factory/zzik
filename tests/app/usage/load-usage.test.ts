import { describe, expect, it } from 'vitest'
import { buildUsageLoadView } from '@app/usage/load-usage'
import type { UsageCollectionMeta } from '../../../shared/usage-contract'
import normalRaw from '../../fixtures/claude-usage.normal.json'
import codexNormalRaw from '../../fixtures/codex-usage.normal.json'
import { NOW, NOW_ISO } from '../../fakes/usage-ports'

const NOW_MS = NOW.getTime()

function collectionMeta(overrides: Partial<UsageCollectionMeta> = {}): UsageCollectionMeta {
  return {
    schema: 1,
    provider: 'claude',
    status: 'ok',
    called: true,
    runAt: '2026-11-11T12:00:00.000Z',
    fetchedAt: '2026-11-11T12:00:00.000Z',
    httpStatus: 200,
    retryAt: null,
    tokenExpiresAt: null,
    kvTokenExpiresAt: null,
    intervalSec: 300,
    collectorVersion: '0.2.0',
    rawOmitted: null,
    ...overrides,
  }
}

describe('Given the usage load view builder', () => {
  it('When raw exists then the report is built from it (0.2.1 계약 그대로)', () => {
    const view = buildUsageLoadView({ usage: normalRaw, collection: null, rawText: null }, NOW, 'claude')
    expect(view.collectionOk).toBe(true)
    expect(view.lastSuccessAt).toBeNull() // 봉투가 없는 목 데이터
    expect(view.report.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 37 })
  })

  it('When the provider is codex then the codex normalizer runs and fetchedAt feeds reset_after_seconds', () => {
    const view = buildUsageLoadView(
      { usage: codexNormalRaw, collection: collectionMeta({ fetchedAt: NOW_ISO }), rawText: null },
      NOW,
      'codex',
    )
    expect(view.report.windows.map((window) => window.id)).toEqual(['rate_limit.primary_window', 'rate_limit.secondary_window'])
    expect(view.lastSuccessAt).toBe(NOW_ISO)
  })

  it('When usage is null (아직 성공 본문이 없음) then an empty report is produced without throwing', () => {
    const view = buildUsageLoadView({ usage: null, collection: null, rawText: null }, NOW, 'claude')
    expect(view.report.windows).toEqual([])
    expect(view.report.metrics).toEqual([])
  })

  it('When the envelope metadata exists then fetchedAt is the last success time', () => {
    const view = buildUsageLoadView(
      { usage: normalRaw, collection: collectionMeta(), rawText: null },
      NOW,
      'claude',
    )
    expect(view.lastSuccessAt).toBe('2026-11-11T12:00:00.000Z')
    expect(view.collectionOk).toBe(true)
  })

  it('When the collection status is not ok then the collection judgment fails', () => {
    const view = buildUsageLoadView(
      { usage: normalRaw, collection: collectionMeta({ status: 'rate_limited' }), rawText: null },
      NOW,
      'claude',
    )
    expect(view.collectionOk).toBe(false)
  })
})

describe('Given collection staleness (D4의 두 표)', () => {
  it('When the value is within 3× the interval then it is still ok; past the boundary it fails', () => {
    const exactly = buildUsageLoadView(
      { usage: normalRaw, collection: collectionMeta({ fetchedAt: new Date(NOW_MS - 3 * 300_000).toISOString() }), rawText: null },
      NOW,
      'claude',
    )
    expect(exactly.collectionOk).toBe(true)

    const past = buildUsageLoadView(
      { usage: normalRaw, collection: collectionMeta({ fetchedAt: new Date(NOW_MS - 3 * 300_000 - 1).toISOString() }), rawText: null },
      NOW,
      'claude',
    )
    expect(past.collectionOk).toBe(false)
  })

  it('When the collector has stopped writing (runAt stale) then the judgment fails', () => {
    const view = buildUsageLoadView(
      { usage: normalRaw, collection: collectionMeta({ runAt: new Date(NOW_MS - 3 * 300_000 - 1).toISOString() }), rawText: null },
      NOW,
      'claude',
    )
    expect(view.collectionOk).toBe(false)
  })
})
