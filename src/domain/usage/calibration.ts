import type { RawUsage, RawUsageEntry } from './types'

/**
 * 목 fixture의 `resets_at`을 "지금" 기준으로 옮긴다.
 *
 * fixture는 작성 시점(FIXTURE_ANCHOR)에 고정된 절대 시각을 담고 있어서, 시간이 지나면
 * 모든 창이 "리셋 시각 경과"로 보인다. 원본과의 **상대 간격을 유지한 채** 기준 시각만
 * 옮기면 미래/과거 관계(정상 리셋, 이미 지난 리셋)가 그대로 보존된다.
 *
 * - 입력을 변경하지 않고 새 객체를 돌려준다. 키 순서는 유지한다.
 * - `null` 항목, `resets_at`이 없거나 해석할 수 없는 항목은 손대지 않는다.
 */
export function rebaseUsageResetsAt(raw: RawUsage, from: Date, to: Date): RawUsage {
  const delta = to.getTime() - from.getTime()
  const out: RawUsage = {}

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      out[key] = value as RawUsageEntry
      continue
    }
    const resetsAt = typeof value['resets_at'] === 'string' ? parseTime(value['resets_at']) : null
    if (resetsAt === null) {
      out[key] = value as RawUsageEntry
      continue
    }
    out[key] = { ...value, resets_at: new Date(resetsAt + delta).toISOString() } as RawUsageEntry
  }

  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseTime(value: string): number | null {
  if (value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
