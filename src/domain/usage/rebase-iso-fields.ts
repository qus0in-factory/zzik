/**
 * DEV 전용: 지정한 키의 ISO 시각을 `from` 기준에서 `to` 기준으로 옮긴다(픽스처가 "리셋 시각 경과"로
 * 굳지 않게). 마스킹·합성된 원본 값은 보존하고, 키가 목록에 없거나 시각으로 해석되지 않는 값은 건드리지 않는다.
 */
export function rebaseIsoFields(raw: Record<string, unknown>, keys: readonly string[], from: Date, to: Date): Record<string, unknown> {
  const delta = to.getTime() - from.getTime()
  const visit = (value: unknown, key = ''): unknown => {
    if (keys.includes(key) && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
      return new Date(Date.parse(value) + delta).toISOString()
    }
    if (Array.isArray(value)) return value.map((item) => visit(item))
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, visit(item, field)]))
    }
    return value
  }
  return visit(raw) as Record<string, unknown>
}
