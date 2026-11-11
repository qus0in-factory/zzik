import { aggregateUsageLevel, usageLevelOf } from './level'
import { formatResetRemaining, isResetExpired } from './staleness'
import type { UsageGatewaySuccess } from './gateway'
import type { UsageIssue, UsageMetric, UsageOther, UsageOtherField, UsageReport, UsageWindow } from './types'
import { codexWindowLabel } from './codex-labels'
import { findUsageWindows, isUnderRateLimit, windowResetAt } from './codex-windows'

export interface BuildCodexUsageViewOptions {
  /** 판정 기준 시각. 주입하지 않으면 현재 시각(테스트는 고정 주입) */
  now?: Date
  /** 봉투의 fetchedAt. reset_after_seconds의 기준이 된다(D6) */
  fetchedAt?: string | null
}

/** 뷰 생성의 입력은 게이트웨이 성공 데이터다(레지스트리가 제공자마다 함수를 돌린다, D8). */
export type CodexViewData = UsageGatewaySuccess

function toOtherValue(value: unknown): UsageOther['value'] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const fields: UsageOtherField[] = Object.entries(value as Record<string, unknown>).map(([key, field]) => ({
      key,
      text: field === null ? 'null' : typeof field === 'object' ? JSON.stringify(field) : String(field),
    }))
    return { kind: 'object', fields }
  }
  const text = value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return { kind: 'value', text }
}

function pathOf(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** 창 경로의 조상(예: rate_limit)인지 */
function isAncestorOfAnyWindow(path: string, windows: Array<{ id: string }>): boolean {
  return windows.some((window) => window.id.startsWith(`${path}.`))
}

/** 창이 아닌 하위 노드의 경로(기타 항목 소재)를 모은다. */
function collectNonWindowPaths(value: unknown, path: string, windows: Array<{ id: string }>, sink: Set<string>, depth: number): void {
  if (depth > 4) return
  if (isAncestorOfAnyWindow(path, windows)) {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) { sink.add(`${path}[]`); return }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectNonWindowPaths(child, `${path}.${key}`, windows, sink, depth + 1)
    }
    return
  }
  sink.add(path)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectNonWindowPaths(child, `${path}.${key}`, windows, sink, depth + 1)
  }
}

/**
 * Codex WHAM 응답의 정규화기(ADR 0.3 D6). 출력은 기존 UsageReport라 화면 컴포넌트를 그대로 쓴다.
 * - 구조에 덜 의존한다: 알려진 경로를 하드코딩하지 않고 창 객체를 찾아낸다(깊이 4, 배열 포함).
 * - rate_limit 아래의 창 → 사용 창(limit_window_seconds 오름차순), 그 밖의 창 → 추가 한도(발견 순서).
 * - rate_limit.limit_reached === true면 전체 상태를 limit으로 올린다.
 * - 완전성 불변식: 모든 최상위 키는 창의 출처이거나 "기타 항목"에 있다.
 */
export function buildCodexUsageView(raw: unknown, options: BuildCodexUsageViewOptions = {}): UsageReport {
  const now = options.now ?? new Date()
  const fetchedAt = options.fetchedAt ?? null
  const invalidShape: UsageReport = {
    status: 'unknown', windows: [], metrics: [], others: [], issues: [{ code: 'invalid_shape' }], raw: null,
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return invalidShape
  const data = raw as Record<string, unknown>
  const issues: UsageIssue[] = []
  const pushIssue = (issue: UsageIssue): void => { issues.push(issue) }

  const all = findUsageWindows(data)
  const underRate = all.filter((window) => isUnderRateLimit(window.id))
  const outside = all.filter((window) => !isUnderRateLimit(window.id))

  underRate.sort((a, b) => {
    const secondsOf = (window: { value: Record<string, unknown> }): number => {
      const seconds = window.value['limit_window_seconds']
      return typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : Number.POSITIVE_INFINITY
    }
    return secondsOf(a) - secondsOf(b)
  })

  const buildOne = (found: { id: string; value: Record<string, unknown> }) => {
    const topKey = found.id.split('.')[0] ?? found.id
    const labelInfo = codexWindowLabel(found.value, found.id, topKey)
    const rawPercent = found.value['used_percent']
    const usedPercent = typeof rawPercent === 'number' && Number.isFinite(rawPercent) && rawPercent >= 0 ? rawPercent : null
    if (usedPercent === null) pushIssue({ code: 'invalid_utilization', key: found.id })
    const resetsAt = windowResetAt(found.value, fetchedAt)
    const base = {
      id: found.id,
      label: labelInfo.label,
      usedPercent,
      resetsAt,
      expired: isResetExpired(resetsAt, now),
      status: usageLevelOf(usedPercent),
      resetText: formatResetRemaining(resetsAt, now),
    }
    return isUnderRateLimit(found.id)
      ? { ...base, unknown: labelInfo.unknown }
      : { ...base, unknown: true }
  }

  const windows: UsageWindow[] = underRate.map(buildOne)
  const metrics: UsageMetric[] = outside.map(buildOne)

  // 기타 항목: 창을 하나도 내지 않은 최상위 키 전체 + 창을 낸 키의 나머지 필드(D6).
  const consumedTopKeys = new Set(all.map((window) => window.id.split('.')[0]))
  const others: UsageOther[] = []
  for (const [key, value] of Object.entries(data)) {
    if (!consumedTopKeys.has(key)) {
      others.push({ id: key, label: key, value: toOtherValue(value) })
      continue
    }
    const sink = new Set<string>()
    collectNonWindowPaths(data[key], key, all, sink, 0)
    sink.delete(key)
    for (const path of sink) {
      const valueAtPath = pathOf(data, path)
      others.push({ id: path, label: path, value: toOtherValue(valueAtPath) })
    }
  }

  const status = aggregateUsageLevel(
    [...windows, ...metrics].map((item) => ({ status: item.status, expired: item.expired })),
  )
  const rateLimit = data['rate_limit']
  const limitReached =
    rateLimit !== null && typeof rateLimit === 'object' && !Array.isArray(rateLimit) &&
    (rateLimit as Record<string, unknown>)['limit_reached'] === true

  return {
    status: limitReached ? 'limit' : status,
    windows,
    metrics,
    others,
    issues: issues as UsageIssue[],
    raw: data as unknown as import('./types').RawUsage,
  }
}
