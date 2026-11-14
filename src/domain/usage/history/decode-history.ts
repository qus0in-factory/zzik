/**
 * 이력 응답 디코드(ADR 0.7 6.2 I6, 11절). 형식 오류는 `invalid_response`, scanVersion 불일치는 `scan_version_mismatch`로
 * `api_error`를 돌려준다. 응답에서 계약의 필드만 골라 새 객체를 만든다 — 알 수 없는 키(원문 `rawText` 등)는 어디에도 남지 않는다.
 */
import { USAGE_HISTORY_SCAN_VERSION } from '../../../../shared/usage-history-contract'
import type { UsageHistoryPage, UsageHistorySample, UsageHistorySummaryEntry, UsageHistoryValue } from '../../../../shared/usage-history-contract'
import type { UsageStatus } from '../../../../shared/usage-contract'
import { USAGE_PROVIDERS } from '../providers'
import type { UsageProvider } from '../providers'
import type { HistoryDecodeErrorCode } from './types'

export type HistoryDecodeFailure = { ok: false; reason: 'api_error'; message: HistoryDecodeErrorCode }
const invalid: HistoryDecodeFailure = { ok: false, reason: 'api_error', message: 'invalid_response' }
const mismatch: HistoryDecodeFailure = { ok: false, reason: 'api_error', message: 'scan_version_mismatch' }

const STATUSES: readonly UsageStatus[] = ['ok', 'rate_limited', 'token_expired', 'auth_required', 'auth_rejected', 'no_credentials', 'upstream_error', 'network_error']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isTimeOrNull = (value: unknown): value is string | null => value === null || isTime(value)
const isNumberOrNull = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value))

function decodeValue(raw: unknown): UsageHistoryValue | null {
  if (!isRecord(raw)) return null
  const { id, usedPercent, resetsAt, cycleSeconds } = raw
  if (typeof id !== 'string' || typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) return null
  if (!isTimeOrNull(resetsAt) || !isNumberOrNull(cycleSeconds)) return null
  return { id, usedPercent, resetsAt, cycleSeconds }
}

function decodeSample(raw: unknown): UsageHistorySample | null {
  if (!isRecord(raw)) return null
  const { id, runAt, status, fetchedAt, intervalSec, values } = raw
  if (typeof id !== 'string' || id === '' || !isTime(runAt)) return null
  if (typeof status !== 'string' || !STATUSES.includes(status as UsageStatus)) return null
  if (!isTimeOrNull(fetchedAt) || !isNumberOrNull(intervalSec)) return null
  let decoded: UsageHistoryValue[] | null
  if (values === null) decoded = null
  else if (Array.isArray(values)) {
    decoded = []
    for (const item of values) {
      const value = decodeValue(item)
      if (value === null) return null
      decoded.push(value)
    }
  } else return null
  return { id, runAt, status: status as UsageStatus, fetchedAt, intervalSec, values: decoded }
}

/** 한 쪽의 응답을 검증·정리한다. `provider`는 요청한 제공자(응답과 다르면 invalid_response). */
export function decodeHistoryPage(raw: unknown, provider: UsageProvider): { ok: true; page: UsageHistoryPage } | HistoryDecodeFailure {
  if (!isRecord(raw)) return invalid
  // 버전이 다르면 나머지 형상을 믿을 수 없으므로 먼저 본다(새 서버가 필드를 바꿨을 수 있다).
  if (typeof raw.scanVersion === 'number' && raw.scanVersion !== USAGE_HISTORY_SCAN_VERSION) return mismatch
  if (raw.scanVersion !== USAGE_HISTORY_SCAN_VERSION || raw.provider !== provider) return invalid
  if (!Array.isArray(raw.samples) || typeof raw.hasMore !== 'boolean') return invalid
  if (raw.nextCursor !== null && typeof raw.nextCursor !== 'string') return invalid
  const samples: UsageHistorySample[] = []
  for (const item of raw.samples) {
    const sample = decodeSample(item)
    if (sample === null) return invalid
    samples.push(sample)
  }
  let anchor: UsageHistorySample | null = null
  if (raw.anchor !== null && raw.anchor !== undefined) {
    anchor = decodeSample(raw.anchor)
    if (anchor === null) return invalid
  }
  return { ok: true, page: { provider, scanVersion: USAGE_HISTORY_SCAN_VERSION, samples, anchor, nextCursor: raw.nextCursor, hasMore: raw.hasMore } }
}

export function decodeHistorySummary(raw: unknown): { ok: true; summary: UsageHistorySummaryEntry[] } | HistoryDecodeFailure {
  if (!isRecord(raw) || !Array.isArray(raw.summary)) return invalid
  const summary: UsageHistorySummaryEntry[] = []
  for (const item of raw.summary) {
    if (!isRecord(item)) return invalid
    const { provider, okCount, firstOkAt, lastOkAt } = item
    if (typeof provider !== 'string' || !(USAGE_PROVIDERS as readonly string[]).includes(provider)) return invalid
    if (typeof okCount !== 'number' || !Number.isFinite(okCount) || !isTimeOrNull(firstOkAt) || !isTimeOrNull(lastOkAt)) return invalid
    summary.push({ provider: provider as UsageProvider, okCount, firstOkAt, lastOkAt })
  }
  return { ok: true, summary }
}
