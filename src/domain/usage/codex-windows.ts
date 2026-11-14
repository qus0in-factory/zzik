import { readCodexWindows } from '../../../shared/usage-scan/codex.ts'
import type { UsageIssue, UsageOtherValue } from './types'

/**
 * WHAM 응답의 "창 객체" 탐색 (ADR 0.3 D6).
 *
 * 창 객체: `used_percent`가 0 이상 유한 숫자이고, `limit_window_seconds`·`reset_at`·
 * `reset_after_seconds` 중 하나 이상을 가진 객체. 구조를 하드코딩하지 않고 깊이 4까지
 * 훑어서 찾는다(배열 포함). 항목 id는 JSON 경로(`rate_limit.primary_window`)다.
 */

const STATUS_FIELDS = ['allowed', 'limit_reached'] as const

export interface CodexWindowEntry {
  /** JSON 경로. 화면 카드 id로 쓴다. */
  path: string
  /** 최상위 키(라벨 접두·기타 항목 묶음에 쓴다) */
  topKey: string
  insideRateLimit: boolean
  usedPercent: number
  limitWindowSeconds: number | null
  resetsAt: string | null
}

export interface CodexOtherEntry {
  id: string
  value: UsageOtherValue
}

export interface CodexScan {
  windows: CodexWindowEntry[]
  otherEntries: CodexOtherEntry[]
  issues: UsageIssue[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function toText(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function topKeyOf(path: string): string {
  return path.split(/[.[]/)[0]
}

function otherValueFor(value: unknown): UsageOtherValue {
  if (!isRecord(value)) return { kind: 'value', text: toText(value) }
  return { kind: 'object', fields: Object.entries(value).map(([key, field]) => ({ key, text: toText(field) })) }
}

export function scanCodexUsage(raw: unknown, options: { fetchedAt?: string | null } = {}): CodexScan {
  if (!isRecord(raw)) {
    return { windows: [], otherEntries: [], issues: [{ code: 'invalid_shape', key: undefined }] }
  }

  const scanned = readCodexWindows(raw, options)
  const windows: CodexWindowEntry[] = scanned.windows.map(window => ({...window, topKey:topKeyOf(window.path)}))
  const issues: UsageIssue[] = scanned.invalidPaths.map(key => ({code:'invalid_utilization',key}))
  const windowPaths = new Set(windows.map((window) => window.path))
  const hasWindowUnder = (prefix: string): boolean =>
    windows.some((window) => window.path.startsWith(`${prefix}.`) || window.path.startsWith(`${prefix}[`))

  const otherEntries: CodexOtherEntry[] = []
  for (const [key, value] of Object.entries(raw)) {
    const windowsHere = windows.filter(
      (window) => window.path === key || window.path.startsWith(`${key}.`) || window.path.startsWith(`${key}[`),
    )

    if (windowsHere.length === 0) {
      otherEntries.push({ id: key, value: otherValueFor(value) })
      continue
    }
    if (windowPaths.has(key)) continue
    if (!isRecord(value)) continue

    const fields = Object.entries(value)
      .filter(([field]) => {
        const path = `${key}.${field}`
        return !windowPaths.has(path) && !hasWindowUnder(path) && !(STATUS_FIELDS as readonly string[]).includes(field)
      })
      .map(([field, fieldValue]) => ({ key: field, text: toText(fieldValue) }))
    if (fields.length > 0) otherEntries.push({ id: key, value: { kind: 'object', fields } })
  }

  return { windows, otherEntries, issues }
}
