/** Codex 창의 라벨 규칙(ADR 0.3 D6). 길이·경로 기반이고, 확인된 것만 고정 라벨이다. */

export interface CodexWindowLabel {
  label: string
  /** 미확인: 길이를 모르거나 rate_limit 밖의 창. 화면에 "미확인" 배지를 붙인다. */
  unknown: boolean
}

const KNOWN_LENGTHS: Record<number, string> = {
  18000: '5시간 한도',
  604800: '주간 한도',
}

function lengthLabel(seconds: number): string {
  if (seconds >= 86_400) {
    const days = Math.round((seconds / 86_400) * 10) / 10
    return Number.isInteger(days) ? `${days}일 한도` : `${days}일 한도`
  }
  const hours = Math.round((seconds / 3_600) * 10) / 10
  return Number.isInteger(hours) ? `${hours}시간 한도` : `${hours}시간 한도`
}

function prettyTopKey(topKey: string): string {
  return topKey.replaceAll('_', ' ')
}

/**
 * @param windowValue 창 객체
 * @param path 창의 JSON 경로(id)
 * @param topKey 창이 속한 최상위 키
 */
export function codexWindowLabel(windowValue: Record<string, unknown>, path: string, topKey: string): CodexWindowLabel {
  const seconds = windowValue['limit_window_seconds']
  const known = typeof seconds === 'number' && Number.isFinite(seconds) ? (KNOWN_LENGTHS[seconds] ?? undefined) : undefined
  const base = typeof seconds === 'number' && Number.isFinite(seconds) ? (known ?? lengthLabel(seconds)) : path
  if (path === 'rate_limit' || path.startsWith('rate_limit.')) {
    return { label: base, unknown: known === undefined }
  }
  return { label: `${prettyTopKey(topKey)} · ${base}`, unknown: true }
}
