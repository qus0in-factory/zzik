/** DEV-only date rebasing, preserving the original masked/synthetic data. */
export function rebaseAntigravityResetsAt(raw: Record<string, unknown>, from: Date, to: Date): Record<string, unknown> {
  const delta = to.getTime() - from.getTime()
  const visit = (value: unknown, key = ''): unknown => {
    if (key === 'resetTime' && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
      return new Date(Date.parse(value) + delta).toISOString()
    }
    if (Array.isArray(value)) return value.map(item => visit(item))
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, visit(field, key)]))
    return value
  }
  return visit(raw) as Record<string, unknown>
}
