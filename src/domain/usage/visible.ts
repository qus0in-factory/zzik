import type { UsageOther, UsageReport } from './types'

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.some(hasValue)
  if (typeof value === 'object') return Object.values(value).some(hasValue)
  return true // zero and false are data
}

function hasTextValue(text: string): boolean {
  try { return hasValue(JSON.parse(text)) } catch { return hasValue(text) }
}

/** Domain display policy; the UI receives populated items only, raw is retained. */
export function visibleUsageReport(report: UsageReport): UsageReport {
  const others: UsageOther[] = report.others.flatMap(item => {
    if (item.value.kind === 'value') return hasTextValue(item.value.text) ? [item] : []
    const fields = item.value.fields.filter(field => hasTextValue(field.text))
    return fields.length ? [{ ...item, value: { kind: 'object' as const, fields } }] : []
  })
  return {
    ...report,
    windows: report.windows.filter(item => item.usedPercent !== null),
    metrics: report.metrics.filter(item => item.usedPercent !== null),
    others,
  }
}
