import { formatAge } from '@domain/usage/staleness'

/**
 * 상태 줄과 stale 안내의 표시 문구(app에서 계산해 ui에 넘긴다 — ui는 판정하지 않는다).
 * 절대 시각은 브라우저 시간대 HH:MM, 상대 표기는 domain의 formatAge를 쓴다.
 */

function timeText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** `마지막 수집 11:58 (2분 전)` — lastSuccessAt이 없으면 null. */
export function composeLastSuccessText(iso: string | null, nowIso: string | null): string | null {
  if (iso === null) return null
  return `마지막 수집 ${timeText(iso)} (${formatAge(iso, new Date(nowIso ?? iso))})`
}

/** `마지막 성공 2분 전` — stale 안내 문구. */
export function composeStaleNoteText(iso: string | null, nowIso: string | null): string | null {
  if (iso === null) return null
  return `마지막 성공 ${formatAge(iso, new Date(nowIso ?? iso))}`
}
