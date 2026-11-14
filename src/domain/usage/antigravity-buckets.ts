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

/** `agy -p /quota` 원문(JSON)의 source 값. 수집기와 이 파서가 같은 문자열을 쓴다. */
export const AGY_QUOTA_RAW_SOURCE = 'agy-quota-cli'

/** 알려진 그룹·라벨 조합은 기존 bucketId·주기로 매핑한다(대시보드·이력 호환). */
const KNOWN_CLI_BUCKETS: Record<string, { id: string; window: string }> = {
  'gemini models\u0000weekly limit remaining': { id: 'gemini-weekly', window: 'weekly' },
  'gemini models\u0000five hour limit remaining': { id: 'gemini-5h', window: '5h' },
  'claude and gpt models\u0000weekly limit remaining': { id: '3p-weekly', window: 'weekly' },
  'claude and gpt models\u0000five hour limit remaining': { id: '3p-5h', window: '5h' },
}

function cliWindow(label: string): string {
  if (/weekly/i.test(label)) return 'weekly'
  if (/five hour/i.test(label)) return '5h'
  return '알 수 없는'
}

/** CLI 행 하나를 대시보드 창으로 해석한다. 모르는 그룹은 원문 그대로 두고 id만 합성한다. */
export function antigravityCliBucket(group: string, label: string): { id: string; window: string } {
  const known = KNOWN_CLI_BUCKETS[`${group.trim().toLowerCase()}\u0000${label.trim().toLowerCase()}`]
  if (known !== undefined) return known
  if (group.trim().toLowerCase() === 'gemini 4 argon') return { id: 'argon-weekly', window: 'weekly' }
  return { id: `cli:${group}:${label}`, window: cliWindow(label) }
}

/** `{ source: 'agy-quota-cli', rows: [...] }` 원문을 창 목록으로 바꾼다. */
function scanAgyQuotaRows(raw: Record<string, unknown>): { buckets: AntigravityBucket[]; issues: UsageIssue[] } {
  if (!Array.isArray(raw.rows)) return { buckets: [], issues: [{ code: 'invalid_shape' }] }
  const buckets: AntigravityBucket[] = []
  const issues: UsageIssue[] = []
  const seenIds = new Map<string, number>()
  const groupIndexes = new Map<string, number>()
  raw.rows.forEach((row: unknown, index: number) => {
    const path = 'rows[' + index + ']'
    if (!isRecord(row)) { issues.push({ code: 'invalid_entry', key: path }); return }
    const group = row.group
    const label = row.label
    const percent = row.remainingPercent
    if (!nonempty(group) || !nonempty(label)) { issues.push({ code: 'invalid_entry', key: path }); return }
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      issues.push({ code: 'invalid_utilization', key: path })
      return
    }
    const mapped = antigravityCliBucket(group, label)
    seenIds.set(mapped.id, (seenIds.get(mapped.id) ?? 0) + 1)
    if (!groupIndexes.has(group)) groupIndexes.set(group, groupIndexes.size)
    const resetsAt = typeof row.resetsAt === 'string' && Number.isFinite(Date.parse(row.resetsAt)) ? row.resetsAt : null
    buckets.push({
      id: mapped.id,
      groupIndex: groupIndexes.get(group) ?? 0,
      groupLabel: group,
      window: mapped.window,
      usedPercent: Math.max(0, Math.min(100, 100 - percent)),
      resetsAt,
    })
  })
  // 같은 id가 두 번 나오면(모르는 그룹의 라벨 중복 등) 뒤엣것은 경로 id로 유일하게 만든다.
  return {
    buckets: buckets.map((bucket, index) => (seenIds.get(bucket.id) ?? 0) > 1 && buckets.findIndex((item) => item.id === bucket.id) !== index
      ? { ...bucket, id: 'rows[' + index + ']' }
      : bucket),
    issues,
  }
}

/** Keeps API shape handling in one module; never reads clocks or credentials. */
export function scanAntigravityBuckets(raw: unknown): { buckets: AntigravityBucket[]; issues: UsageIssue[] } {
  if (isRecord(raw) && raw.source === AGY_QUOTA_RAW_SOURCE) return scanAgyQuotaRows(raw)
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
