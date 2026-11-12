import { visibleUsageReport } from '@domain/usage/visible'
import type { UsageCollectionMeta } from '../../../shared/usage-contract'
import { buildProviderUsageView } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/view'

/**
 * 게이트웨이 성공 결과를 화면 뷰로 바꾼다(스택 부록 A4, ADR 0.3 D8).
 * - 보고서: 제공자 등록부가 고른 정규화기(claude/codex)로 만든다.
 * - 수집 판정: 봉투 메타의 상태와 나이(0.2 D4의 두 표). 예외는 결과 유니온이 아니라 불리언으로.
 */
export interface UsageSuccessData {
  usage: Record<string, unknown> | null
  collection: UsageCollectionMeta | null
  rawText: string | null
}

/** 화면 안내에 쓰는 수집 상태. 봉투의 status에 수집기 중단·값 노후를 더한다(D8). */
export type UsageCollectionStatus = import('../../../shared/usage-contract').UsageStatus | 'collector_down' | 'stale'

export interface UsageLoadView {
  report: UsageReport
  /** 수집 판정이 정상(봉투 상태 ok + 값·하트비트가 주기 안)인지. 봉투가 없으면(목 데이터) 정상으로 본다. */
  collectionOk: boolean
  /** 마지막 성공 시각(봉투의 fetchedAt). 모의 데이터는 null */
  lastSuccessAt: string | null
  /** 안내 문구용 수집 상태. 봉투가 없으면(목 데이터) null */
  collectionStatus: UsageCollectionStatus | null
  /** 안내에 쓰는 봉투 메타(httpStatus·retryAt 등). 봉투가 없으면 null */
  collectionMeta: UsageCollectionMeta | null
}

const COLLECT_STALE_FACTOR = 3

function collectionStatusOf(collection: UsageCollectionMeta | null, nowMs: number): UsageCollectionStatus | null {
  if (collection === null) return null
  if (collection.status !== 'ok') return collection.status
  const intervalMs = collection.intervalSec * 1000
  const runMs = Date.parse(collection.runAt)
  if (!Number.isNaN(runMs) && nowMs - runMs > COLLECT_STALE_FACTOR * intervalMs) return 'collector_down'
  const fetchedMs = collection.fetchedAt !== null ? Date.parse(collection.fetchedAt) : null
  if (fetchedMs !== null && !Number.isNaN(fetchedMs) && nowMs - fetchedMs > COLLECT_STALE_FACTOR * intervalMs) return 'stale'
  return 'ok'
}

export function buildUsageLoadView(data: UsageSuccessData, now: Date, provider: UsageProvider): UsageLoadView {
  const fetchedAt = data.collection?.fetchedAt ?? null
  const report = visibleUsageReport(
    buildProviderUsageView(provider, data.usage ?? {}, { now, fetchedAt }),
    data.collection?.rawRedacted ?? [],
  )
  const collectionStatus = collectionStatusOf(data.collection, now.getTime())
  return {
    report,
    collectionOk: collectionStatus === null || collectionStatus === 'ok',
    lastSuccessAt: fetchedAt,
    collectionStatus,
    collectionMeta: data.collection,
  }
}
