import type { UsageIssue } from './types'
import { readAntigravity } from '../../../shared/usage-scan/antigravity.ts'
import { isRecord } from '../../../shared/usage-scan/parts.ts'

export interface AntigravityBucket {
  id: string
  groupIndex: number
  groupLabel: string
  window: string
  usedPercent: number
  resetsAt: string | null
}

/** Add display names and issues to the shared value scan, preserving the card API. */
export function scanAntigravityBuckets(raw: unknown): { buckets: AntigravityBucket[]; issues: UsageIssue[] } {
  if (!isRecord(raw) || !Array.isArray(raw.groups)) {
    return { buckets: [], issues: [{ code: 'invalid_shape' }] }
  }
  const groups = raw.groups
  const scan = readAntigravity(raw)
  const buckets = scan.buckets.map(({ bucketIndex: _, ...bucket }) => {
    const group = groups[bucket.groupIndex]
    const name = isRecord(group) ? group.displayName : null
    return {
      ...bucket,
      window: bucket.window || '알 수 없는',
      groupLabel: typeof name === 'string' && name.trim().length > 0 ? name : '그룹 ' + (bucket.groupIndex + 1),
    }
  })
  const issues: UsageIssue[] = scan.problems.map(problem => ({
    code: problem.kind === 'entry' ? 'invalid_entry' : 'invalid_utilization',
    key: problem.path,
  }))
  return { buckets, issues }
}
