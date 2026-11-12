import type { UsageOther, UsageReport } from './types'

/** Collector-independent display fallback when envelope metadata is unavailable. */
export const REDACTED_VALUE = '[가림]'

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0 && value.trim() !== REDACTED_VALUE
  if (Array.isArray(value)) return value.some(hasValue)
  if (typeof value === 'object') return Object.values(value).some(hasValue)
  return true // zero and false are data
}

function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, '.$1')
}

function isRedacted(path: string, paths: readonly string[]): boolean {
  const normalized = normalizePath(path)
  return paths.some(redacted => normalized === redacted || normalized.startsWith(redacted + '.'))
}

/** Remove nested redacted fields before formatting JSON-valued other fields. */
function omitRedacted(value: unknown, path: string, paths: readonly string[]): unknown {
  if (isRedacted(path, paths)) return undefined
  if (Array.isArray(value)) return value.map((item, index) => omitRedacted(item, path + '.' + index, paths))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const next = omitRedacted(item, path + '.' + key, paths)
      return next === undefined ? [] : [[key, next]]
    }))
  }
  return value
}

function visibleText(text: string, path: string, paths: readonly string[]): string | null {
  if (isRedacted(path, paths)) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = text }
  const value = omitRedacted(parsed, path, paths)
  if (!hasValue(value)) return null
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
