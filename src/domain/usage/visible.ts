import type { UsageOther, UsageReport } from './types'
import { t } from '@shared/messages'

/** Collector-independent display fallback when envelope metadata is unavailable. */
export const REDACTED_VALUE = t('value.redacted')

function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1')
}

function isRedacted(path: string, paths: readonly string[]): boolean {
  const normalized = normalizePath(path)
  return paths.some(redacted => normalized === redacted || normalized.startsWith(redacted + '.'))
}

/**
 * JSON 값 안쪽을 표시용으로 정리한다. 가림 경로, `[가림]` 상수, null, 빈 문자열과 비워진 컨테이너는
 * 통째로 제거하고(배열은 자리를 남기지 않는다) 0과 false는 데이터로 남긴다. 경로의 배열 인덱스는 원본 기준이다.
 */
function cleanValue(value: unknown, path: string, paths: readonly string[]): unknown {
  if (isRedacted(path, paths) || value === null || value === undefined) return undefined
  if (typeof value === 'string') return value.trim().length === 0 || value.trim() === REDACTED_VALUE ? undefined : value
  if (Array.isArray(value)) {
    const items = value.flatMap((item, index) => {
      const next = cleanValue(item, path + '.' + index, paths)
      return next === undefined ? [] : [next]
    })
    return items.length > 0 ? items : undefined
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const next = cleanValue(item, path + '.' + key, paths)
      return next === undefined ? [] : [[key, next] as const]
    })
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return value
}

function visibleText(text: string, path: string, paths: readonly string[]): string | null {
  if (isRedacted(path, paths)) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = text }
  const value = cleanValue(parsed, path, paths)
  if (value === undefined) return null
  return value !== parsed ? JSON.stringify(value) : text
}

/** Domain display policy; envelope paths take priority over placeholder fallback. */
export function visibleUsageReport(report: UsageReport, rawRedacted: readonly string[] = []): UsageReport {
  const paths = rawRedacted.map(normalizePath)
  const others: UsageOther[] = report.others.flatMap((item): UsageOther[] => {
    if (item.value.kind === 'value') {
      const text = visibleText(item.value.text, item.id, paths)
      return text === null ? [] : [{ ...item, value: { kind: 'value' as const, text } }]
    }
    const fields = item.value.fields.flatMap(field => {
      const text = visibleText(field.text, item.id + '.' + field.key, paths)
      return text === null ? [] : [{ ...field, text }]
    })
    return fields.length ? [{ ...item, value: { kind: 'object' as const, fields } }] : []
  })
  return {
    ...report,
    windows: report.windows.filter(item => item.usedPercent !== null && !isRedacted(item.id, paths)),
    metrics: report.metrics.filter(item => item.usedPercent !== null && !isRedacted(item.id, paths)),
    others,
  }
}
