/**
 * 이력 계층의 포트(ADR 0.7 6.5절). 구현은 infra, 테스트는 가짜를 주입한다.
 */
import type { UsageHistoryPage, UsageHistoryQuery, UsageHistorySummaryEntry } from '../../../../shared/usage-history-contract'
import type { UsageGatewayFailureReason } from '../gateway'
import type { UsageProvider } from '../providers'
import type { HistoryCacheRecord } from './types'

/** 이력 게이트웨이의 실패. 사용량 게이트웨이와 같은 모양이다(`message`는 원시 코드). */
export interface UsageHistoryGatewayFailure {
  ok: false
  reason: UsageGatewayFailureReason
  message: string | null
}

export interface UsageHistoryGateway {
  fetchSummary(): Promise<{ ok: true; summary: UsageHistorySummaryEntry[] } | UsageHistoryGatewayFailure>
  fetchSamples(provider: UsageProvider, query: UsageHistoryQuery): Promise<{ ok: true; page: UsageHistoryPage } | UsageHistoryGatewayFailure>
}

export type HistoryCacheUpdateResult = { ok: true; written: boolean } | { ok: false; reason: 'unavailable' | 'quota' }

export interface HistoryCacheStore {
  read(provider: UsageProvider): Promise<HistoryCacheRecord | null>
  /** mutate가 null을 돌려주면 쓰지 않는다(I4). mutate는 동기 순수 함수(I5) — IndexedDB 트랜잭션 안에서 네트워크를 기다리지 않는다. */
  update(provider: UsageProvider, mutate: (current: HistoryCacheRecord | null) => HistoryCacheRecord | null): Promise<HistoryCacheUpdateResult>
  remove(provider: UsageProvider): Promise<void>
  listProviders(): Promise<UsageProvider[]>
}

/** 동기 key-value 저장소(localStorage·sessionStorage 어댑터). set은 성공 여부를 돌려주고 던지지 않는다. */
export interface KeyValueStorage {
  get(key: string): string | null
  set(key: string, value: string): boolean
  remove(key: string): void
}
