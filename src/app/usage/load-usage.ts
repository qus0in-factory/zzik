import type { UsageCollectionMeta } from '../../../shared/usage-contract'
import type { RawUsage } from '@domain/usage/types'
import { buildUsageView } from '@domain/usage/view'
import type { UsageReport } from '@domain/usage/view'

/**
 * 게이트웨이 성공 결과를 화면 뷰로 바꾼다(스택 부록 A4).
 * - 보고서: raw 응답을 domain의 buildUsageView로(0.2.1 계약과 같다).
 * - 수집 판정: 봉투 메타의 상태와 나이(D4의 두 표). 예외는 결과 유니온이 아니라 불리언으로.
 */
export interface UsageSuccessData {
  usage: RawUsage | null
  collection: UsageCollectionMeta | null
  rawText: string | null
}

export interface UsageLoadView {
  report: UsageReport
  /** 수집 판정이 정상(봉투 상태 ok + 값·하트비트가 주기 안)인지. 봉투가 없으면(목 데이터) 정상으로 본다. */
  collectionOk: boolean
  /** 마지막 성공 시각(봉투의 fetchedAt). 모의 데이터는 null */
  lastSuccessAt: string | null
}

const COLLECT_STALE_FACTOR = 3

function isCollectionOk(collection: UsageCollectionMeta | null, nowMs: number): boolean {
  if (collection === null) return true
  if (collection.status !== 'ok') return false
  const intervalMs = collection.intervalSec * 1000
  const fetchedMs = collection.fetchedAt !== null ? Date.parse(collection.fetchedAt) : null
  if (fetchedMs !== null && !Number.isNaN(fetchedMs) && nowMs - fetchedMs > COLLECT_STALE_FACTOR * intervalMs) return false
  const runMs = Date.parse(collection.runAt)
  if (!Number.isNaN(runMs) && nowMs - runMs > COLLECT_STALE_FACTOR * intervalMs) return false
  return true
}

export function buildUsageLoadView(data: UsageSuccessData, now: Date): UsageLoadView {
  const report = buildUsageView(data.usage ?? {}, { now })
  return {
    report,
    collectionOk: isCollectionOk(data.collection, now.getTime()),
    lastSuccessAt: data.collection?.fetchedAt ?? null,
  }
}
