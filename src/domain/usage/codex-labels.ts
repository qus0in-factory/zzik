import type { UsageLabel } from './labels'

/**
 * Codex 창 라벨 (ADR 0.3 D6).
 * - 18,000초 → `5시간 한도`, 604,800초 → `주간 한도` (확인된 값)
 * - 그 밖의 길이 → `N시간 한도`/`N일 한도` + 미확인
 * - 길이를 모르면 경로를 라벨로 + 미확인
 * - `rate_limit` 밖의 창은 `<최상위 키를 읽기 좋게> · <창 라벨>` + 미확인
 */

const KNOWN_LABELS: Record<number, string> = {
  18000: '5시간 한도',
  604800: '주간 한도',
}

export interface CodexLabelInput {
  path: string
  topKey: string
  limitWindowSeconds: number | null
  insideRateLimit: boolean
}

function durationText(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}일`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}시간`
  return `${Math.floor(seconds / 60)}분`
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** `code_review_rate_limit` → `Code Review Rate Limit`, `mcp` → `Mcp` */
export function humanizeTopKey(key: string): string {
  return key
    .split('_')
    .filter((part) => part.length > 0)
    .map(capitalize)
    .join(' ')
}

export function codexWindowLabel({ path, topKey, limitWindowSeconds, insideRateLimit }: CodexLabelInput): UsageLabel {
  const sane = limitWindowSeconds !== null && Number.isFinite(limitWindowSeconds) && limitWindowSeconds > 0
  const known = sane ? KNOWN_LABELS[Math.floor(limitWindowSeconds)] : undefined

  const base: UsageLabel = !sane
    ? { label: path, unknown: true }
    : known !== undefined
      ? { label: known, unknown: false }
      : { label: `${durationText(limitWindowSeconds)} 한도`, unknown: true }

  if (insideRateLimit) return base
  return { label: `${humanizeTopKey(topKey)} · ${base.label}`, unknown: true }
}
