/**
 * 이력 동기화(ADR 0.7 6.3절): 정방향(최신 쪽으로)과 백필(과거 쪽으로). 네트워크는 `update` 밖에서 끝내고(I5),
 * 저장마다 직전에 읽은 커버리지를 들고 가 비교 후 교체(I4)한다. 중간에 실패해도 I1(표본 = 서버의 [coveredFrom, cursor])이 유지된다.
 */
import { USAGE_HISTORY_PAGE_LIMIT } from '../../../../shared/usage-history-contract'
import type { UsageHistoryPage, UsageHistoryQuery, UsageHistorySample } from '../../../../shared/usage-history-contract'
import type { HistoryCacheStore, UsageHistoryGateway, UsageHistoryGatewayFailure } from '@domain/usage/history/ports'
import { applyBackfill, applyForward, coverageOf, HISTORY_RECORD_MAX_AGE_MS, HISTORY_RECORD_MAX_SAMPLES, isForwardStale, validateRecord, withSync } from '@domain/usage/history/record'
import type { Coverage } from '@domain/usage/history/record'
import type { HistoryCacheRecord } from '@domain/usage/history/types'
import type { UsageProvider } from '@domain/usage/providers'

/** 첫 정방향 폭(12.2절): 레코드가 없으면 최근 24시간만 먼저 받는다. */
export const FIRST_FORWARD_WINDOW_MS = 24 * 3_600_000
/** 백필 조각 폭. */
export const BACKFILL_CHUNK_MS = 24 * 3_600_000
/** 스냅샷이 없을 때의 동기화 최소 간격. */
export const NO_SNAPSHOT_MIN_INTERVAL_MS = 15 * 60_000
export const SYNC_REQUEST_BUDGET = 80
export const WINDOW_REQUEST_BUDGET = 120
export const WINDOW_MS = 15 * 60_000

/** 요청 예산(폭주 차단): 동기화 한 번에 80요청, 제공자당 15분에 120요청. */
export function createHistoryBudget(options: { now: () => number; perSync?: number; perWindow?: number; windowMs?: number }) {
  const perSync = options.perSync ?? SYNC_REQUEST_BUDGET
  const perWindow = options.perWindow ?? WINDOW_REQUEST_BUDGET
  const windowMs = options.windowMs ?? WINDOW_MS
  const stamps = new Map<UsageProvider, number[]>()
  return {
    /** 동기화 한 번을 시작한다. 반환 함수를 요청 직전에 부르면 허용 여부가 나온다. */
    begin(provider: UsageProvider): () => boolean {
      let used = 0
      return () => {
        const now = options.now()
        const recent = (stamps.get(provider) ?? []).filter((stamp) => now - stamp < windowMs)
        if (used >= perSync || recent.length >= perWindow) {
          stamps.set(provider, recent)
          return false
        }
        used += 1
        recent.push(now)
        stamps.set(provider, recent)
        return true
      }
    },
  }
}
export type HistoryBudget = ReturnType<typeof createHistoryBudget>

export interface SyncDeps {
  gateway: UsageHistoryGateway
  cache: HistoryCacheStore
  /** 저장소를 못 쓸 때(quota·unavailable) 이번 세션의 레코드를 두는 메모리. */
  memory: Map<UsageProvider, HistoryCacheRecord>
  nowMs: () => number
  budget: HistoryBudget
  /** 쪽 크기(기본 50). */
  pageLimit?: number
  /** 레코드가 갱신될 때마다(확정된 쪽·조각 단위). */
  onRecord?: (record: HistoryCacheRecord) => void
  /** 백필 진행(끝난 조각 수, 전체 조각 수). */
  onProgress?: (done: number, total: number) => void
}

export interface SyncArgs {
  provider: UsageProvider
  /** 스냅샷의 runAt. 모르면(조회 실패·DEV) null. */
  snapshotRunAt: string | null
  /** 선택 범위의 시작(epoch ms). 백필이 필요 없으면 null. */
  wantFromMs: number | null
}

export type SyncOutcome =
  | { ok: true; record: HistoryCacheRecord; skipped: boolean; persisted: boolean; /** 표본 상한·31일 보존 경계에 닿아 백필을 마쳤다(더 과거는 보존하지 않는다) */ backfillComplete?: boolean }
  | { ok: false; reason: 'gateway'; failure: UsageHistoryGatewayFailure; record: HistoryCacheRecord | null }
  | { ok: false; reason: 'version_mismatch' | 'budget' | 'conflict'; record: HistoryCacheRecord | null }

type Fetched = { ok: true; page: UsageHistoryPage } | { ok: false; outcome: SyncOutcome }

export async function syncHistory(deps: SyncDeps, args: SyncArgs): Promise<SyncOutcome> {
  const { provider } = args
  const limit = deps.pageLimit ?? USAGE_HISTORY_PAGE_LIMIT
  const take = deps.budget.begin(provider)
  const iso = (ms: number): string => new Date(ms).toISOString()
  let persisted = true
  let latest: HistoryCacheRecord | null = null

  const readCurrent = async (): Promise<HistoryCacheRecord | null> => {
    const fromMemory = deps.memory.get(provider)
    if (fromMemory !== undefined) return fromMemory
    const stored = await deps.cache.read(provider)
    if (stored === null) return null
    const valid = validateRecord(stored, provider)
    if (valid === null || isForwardStale(valid, deps.nowMs())) {
      await deps.cache.remove(provider)
      return null
    }
    return valid
  }

  /** mutate를 저장소에 적용한다. 저장소를 못 쓰면 메모리로 옮겨 계속한다. 쓰지 않았으면(CAS 불일치) written=false. */
  const commit = async (mutate: (current: HistoryCacheRecord | null) => HistoryCacheRecord | null): Promise<{ written: boolean; record: HistoryCacheRecord | null }> => {
    let computed: HistoryCacheRecord | null = null
    const wrapped = (current: HistoryCacheRecord | null): HistoryCacheRecord | null => (computed = mutate(current))
    if (deps.memory.has(provider)) {
      const next = wrapped(deps.memory.get(provider) ?? null)
      if (next !== null) deps.memory.set(provider, next)
      return { written: next !== null, record: next }
    }
    const result = await deps.cache.update(provider, wrapped)
    if (result.ok) return { written: result.written, record: computed }
    // 저장소 오류: 이번 세션은 메모리로 옮겨 계속한다. **현재 레코드를 먼저 읽어 메모리에 둔 뒤에** quota면 캐시를 비운다
    // (순서가 거꾸로면 비운 뒤 읽어 null이 되어 레코드가 유실된다, ADR 0.7 6.1·6.2).
    persisted = false
    const current = await readCurrentForMemory()
    if (current !== null) deps.memory.set(provider, current)
    if (result.reason === 'quota') await deps.cache.remove(provider)
    const next = mutate(current)
    if (next !== null) deps.memory.set(provider, next)
    return { written: next !== null, record: next }
  }
  const readCurrentForMemory = async (): Promise<HistoryCacheRecord | null> => deps.memory.get(provider) ?? (await deps.cache.read(provider).catch(() => null))

  const fetchPage = async (query: UsageHistoryQuery): Promise<Fetched> => {
    if (!take()) return { ok: false, outcome: { ok: false, reason: 'budget', record: latest } }
    const result = await deps.gateway.fetchSamples(provider, query)
    if (result.ok) return { ok: true, page: result.page }
    if (result.reason === 'api_error' && result.message === 'scan_version_mismatch') return { ok: false, outcome: { ok: false, reason: 'version_mismatch', record: latest } }
    return { ok: false, outcome: { ok: false, reason: 'gateway', failure: result, record: latest } }
  }

  const publish = (record: HistoryCacheRecord | null): void => {
    if (record === null) return
    latest = record
    deps.onRecord?.(record)
  }

  let record = await readCurrent()
  latest = record
  const snapshotKnown = args.snapshotRunAt !== null
  const unchanged = record !== null && (snapshotKnown ? record.syncedThroughRunAt === args.snapshotRunAt : deps.nowMs() - Date.parse(record.syncedAt) < NO_SNAPSHOT_MIN_INTERVAL_MS)

  // 정방향
  if (!unchanged) {
    let restarted = false
    forward: for (;;) {
      const expected: Coverage | null = coverageOf(record)
      const firstFrom = iso(deps.nowMs() - FIRST_FORWARD_WINDOW_MS)
      let query: UsageHistoryQuery =
        record === null ? { from: firstFrom, limit, anchor: true } : record.cursor !== null ? { after: record.cursor, limit } : { from: record.coveredFrom ?? firstFrom, limit }
      let current = expected
      for (;;) {
        const fetched = await fetchPage(query)
        if (!fetched.ok) return fetched.outcome
        const { page } = fetched
        const result = await commit((stored) => applyForward(stored, current, page, { provider, now: iso(deps.nowMs()), initialFrom: query.from ?? null }))
        if (!result.written || result.record === null) {
          if (restarted) return { ok: false, reason: 'conflict', record: latest }
          restarted = true
          record = await readCurrent()
          continue forward
        }
        record = result.record
        publish(record)
        current = coverageOf(record)
        if (!page.hasMore || page.nextCursor === null) break
        query = { after: page.nextCursor, limit }
      }
      break
    }
    if (record !== null && snapshotKnown) {
      const synced = await commit((stored) => (stored === null ? null : withSync(stored, args.snapshotRunAt, iso(deps.nowMs()))))
      if (synced.record !== null) {
        record = synced.record
        publish(record)
      }
    } else if (record !== null) {
      const synced = await commit((stored) => (stored === null ? null : withSync(stored, stored.syncedThroughRunAt, iso(deps.nowMs()))))
      if (synced.record !== null) {
        record = synced.record
        publish(record)
      }
    }
  }

  // 백필: 선택 범위의 시작이 coveredFrom보다 앞일 때만, 하루 조각씩 과거 쪽으로
  // 보존 경계(31일)보다 과거는 어차피 정리되므로 목표를 그 안으로 자른다.
  const wantFrom = args.wantFromMs === null ? null : Math.max(args.wantFromMs, deps.nowMs() - HISTORY_RECORD_MAX_AGE_MS)
  let backfillComplete = false
  if (record !== null && wantFrom !== null && record.coveredFrom !== null && wantFrom < Date.parse(record.coveredFrom)) {
    const total = Math.ceil((Date.parse(record.coveredFrom) - wantFrom) / BACKFILL_CHUNK_MS)
    let done = 0
    let conflicts = 0
    while (record !== null && record.coveredFrom !== null && wantFrom < Date.parse(record.coveredFrom)) {
      const until = record.coveredFrom
      const from = iso(Math.max(Date.parse(until) - BACKFILL_CHUNK_MS, wantFrom))
      const expected = coverageOf(record)
      const samples: UsageHistorySample[] = []
      let anchor: UsageHistorySample | null = null
      let after: string | undefined
      for (let first = true; ; first = false) {
        const query: UsageHistoryQuery = first ? { from, until, limit, anchor: true } : { from, until, after, limit }
        const fetched = await fetchPage(query)
        if (!fetched.ok) return fetched.outcome
        samples.push(...fetched.page.samples)
        if (first) anchor = fetched.page.anchor
        if (!fetched.page.hasMore || fetched.page.nextCursor === null) break
        after = fetched.page.nextCursor
      }
      // 조각이 끝까지 받아졌을 때만 저장한다(조각 단위로 I1 유지).
      const result = await commit((stored) => applyBackfill(stored, expected, { from, samples, anchor }, { provider, now: iso(deps.nowMs()), initialFrom: null }))
      if (!result.written || result.record === null) {
        conflicts += 1
        if (conflicts > 1) return { ok: false, reason: 'conflict', record: latest }
        record = await readCurrent()
        continue
      }
      conflicts = 0
      record = result.record
      publish(record)
      done += 1
      deps.onProgress?.(Math.min(done, total), total)
      // 표본 상한(4,000)에 닿으면 가장 오래된 표본이 정리되어 coveredFrom이 더 과거로 가지 못한다 — 같은 조각을 되풀이하지 않고 완료로 본다.
      if (record.coveredFrom === null || Date.parse(record.coveredFrom) >= Date.parse(until) || record.samples.length >= HISTORY_RECORD_MAX_SAMPLES) {
        backfillComplete = true
        deps.onProgress?.(total, total)
        break
      }
    }
    // 목표가 보존 경계로 잘렸고 그 경계까지 채웠다면 더 과거는 보존하지 않으므로 완료로 본다.
    if (args.wantFromMs !== null && args.wantFromMs < wantFrom && record !== null && record.coveredFrom !== null && Date.parse(record.coveredFrom) <= wantFrom) backfillComplete = true
  }

  return record === null ? { ok: false, reason: 'gateway', failure: { ok: false, reason: 'api_error', message: null }, record: null } : { ok: true, record, skipped: unchanged && wantFrom === null, persisted, ...(backfillComplete ? { backfillComplete } : {}) }
}
