import type { UsageIssue } from './types'

export interface AntigravityBucket {
  id: string
  groupIndex: number
  groupLabel: string
  window: string
  usedPercent: number
  resetsAt: string | null
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/** Keeps API shape handling in one module; never reads clocks or credentials. */
export function scanAntigravityBuckets(raw: unknown): { buckets: AntigravityBucket[]; issues: UsageIssue[] } {
  if (!isRecord(raw) || !Array.isArray(raw.groups)) return { buckets: [], issues: [{ code: 'invalid_shape' }] }
  const counts = new Map<string, number>()
  for (const group of raw.groups) {
    if (!isRecord(group) || !Array.isArray(group.buckets)) continue
    for (const bucket of group.buckets) {
      if (isRecord(bucket) && nonempty(bucket.bucketId)) counts.set(bucket.bucketId, (counts.get(bucket.bucketId) ?? 0) + 1)
    }
  }
  const buckets: AntigravityBucket[] = []
  const issues: UsageIssue[] = []
  raw.groups.forEach((group: unknown, groupIndex: number) => {
    if (!isRecord(group) || !Array.isArray(group.buckets)) {
      issues.push({ code: 'invalid_entry', key: 'groups[' + groupIndex + ']' })
      return
    }
    const groupLabel = nonempty(group.displayName) ? group.displayName : '그룹 ' + (groupIndex + 1)
    group.buckets.forEach((bucket: unknown, bucketIndex: number) => {
      const path = 'groups[' + groupIndex + '].buckets[' + bucketIndex + ']'
      if (!isRecord(bucket)) { issues.push({ code: 'invalid_entry', key: path }); return }
      const fraction = bucket.remainingFraction
      if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
        issues.push({ code: 'invalid_utilization', key: path })
        return
      }
      buckets.push({
        id: nonempty(bucket.bucketId) && counts.get(bucket.bucketId) === 1 ? bucket.bucketId : path,
        groupIndex, groupLabel,
        window: nonempty(bucket.window) ? bucket.window : '알 수 없는',
        usedPercent: Math.max(0, Math.min(100, (1 - fraction) * 100)),
        resetsAt: typeof bucket.resetTime === 'string' && Number.isFinite(Date.parse(bucket.resetTime)) ? bucket.resetTime : null,
      })
    })
  })
  return { buckets, issues }
}
