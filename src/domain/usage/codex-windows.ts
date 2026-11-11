/** Codex WHAM 응답의 "창 객체" 탐색과 리셋 시각 계산(ADR 0.3 D6). 순수 함수다. */

export const CODEX_WINDOW_TRAVERSE_DEPTH = 4

/**
 * 창 객체: used_percent 필드를 가지고(값의 형식 오류는 정규화기가 issues로 기록한다)
 * 리셋 관련 필드 중 하나 이상을 가진 객체다.
 */
export function isUsageWindowObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record['used_percent'] === undefined) return false
  return (
    record['limit_window_seconds'] !== undefined ||
    record['reset_at'] !== undefined ||
    record['reset_after_seconds'] !== undefined
  )
}

export interface FoundWindow {
  /** JSON 경로(id). 예: rate_limit.primary_window. 배열 안의 창은 []로 표기된다. */
  id: string
  value: Record<string, unknown>
}

/** 응답을 깊이 4까지(배열 포함) 훑어 창 객체를 전부 찾는다. 항목 id는 JSON 경로다. */
export function findUsageWindows(root: unknown): FoundWindow[] {
  const found: FoundWindow[] = []
  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > CODEX_WINDOW_TRAVERSE_DEPTH) return
    if (Array.isArray(value)) {
      const arrayPath = path === '' ? '[]' : `${path}[]`
      value.forEach((item) => visit(item, arrayPath, depth + 1))
      return
    }
    if (value === null || typeof value !== 'object') return
    if (isUsageWindowObject(value)) {
      found.push({ id: path, value: value as Record<string, unknown> })
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visit(child, path === '' ? key : `${path}.${key}`, depth + 1)
    }
  }
  visit(root, '', 0)
  return found
}

/**
 * 리셋 시각 계산: reset_at(Unix 초)을 ISO로, 없고 reset_after_seconds가 있으면
 * 봉투의 fetchedAt에 more한다(수집 시각 기준, 화면 시각이 아니다). 둘 다 없으면 null.
 */
export function windowResetAt(value: Record<string, unknown>, fetchedAt: string | null | undefined): string | null {
  const resetAt = value['reset_at']
  if (typeof resetAt === 'number' && Number.isFinite(resetAt)) return new Date(resetAt * 1000).toISOString()
  const after = value['reset_after_seconds']
  if (typeof after === 'number' && Number.isFinite(after) && fetchedAt !== null && fetchedAt !== undefined) {
    const base = Date.parse(fetchedAt)
    if (!Number.isNaN(base)) return new Date(base + after * 1000).toISOString()
  }
  return null
}

/** rate_limit 서브트리인지(D6 배치: 사용 창 vs 추가 한도). */
export function isUnderRateLimit(path: string): boolean {
  return path === 'rate_limit' || path.startsWith('rate_limit.')
}
