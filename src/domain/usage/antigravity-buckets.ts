import type { UsageIssue } from './types'
import { readAntigravity, readAntigravityCliBucket, hasAntigravityShape, AGY_QUOTA_RAW_SOURCE } from '../../../shared/usage-scan/antigravity.ts'
import { isRecord } from '../../../shared/usage-scan/parts.ts'
import { t } from '@shared/messages'
export { AGY_QUOTA_RAW_SOURCE } from '../../../shared/usage-scan/antigravity.ts'

export interface AntigravityBucket {
  id: string
  groupIndex: number
  groupLabel: string
  window: string
  usedPercent: number
  resetsAt: string | null
}

/** Preserve the card parser's public mapping and display fallback. */
export function antigravityCliBucket(group: string, label: string): { id: string; window: string } {
  const mapped = readAntigravityCliBucket(group, label)
  return { ...mapped, window: mapped.window || t('label.window.unknown') }
}

/** Add display names and issues to the shared value scan, preserving both stored formats. */
export function scanAntigravityBuckets(raw: unknown): { buckets: AntigravityBucket[]; issues: UsageIssue[] } {
  if (!hasAntigravityShape(raw)) return { buckets: [], issues: [{ code: 'invalid_shape' }] }
  const cli = raw.source === AGY_QUOTA_RAW_SOURCE
  const entries = (cli ? raw.rows : raw.groups) as unknown[]
  const scan = readAntigravity(raw)
  const buckets = scan.buckets.map(({ bucketIndex, ...bucket }) => {
    const entry = entries[cli ? bucketIndex : bucket.groupIndex]
    const name = isRecord(entry) ? (cli ? entry.group : entry.displayName) : null
    return {
      ...bucket,
      window: bucket.window || t('label.window.unknown'),
      groupLabel: typeof name === 'string' && name.trim().length > 0 ? name : t('label.group.numbered', { n: bucket.groupIndex + 1 }),
    }
  })
  const issues: UsageIssue[] = scan.problems.map(problem => ({
    code: problem.kind === 'entry' ? 'invalid_entry' : 'invalid_utilization',
    key: problem.path,
  }))
  return { buckets, issues }
}
