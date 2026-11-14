/**
 * 시각 관련 판정과 표기 (시나리오 C5·C6, D9).
 * 모든 함수는 `now`를 주입받는다. 전역 Date에는 의존하지 않는다.
 */
import { t } from '@shared/messages'

function parseTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** 리셋 시각이 지났는지. 시각이 없거나 해석 불가면 보수적으로 '지나지 않음'(만료 아님)으로 본다. */
export function isResetExpired(resetsAt: string | null | undefined, now: Date): boolean {
  const target = parseTime(resetsAt)
  if (target === null) return false
  return target < now.getTime()
}

/** 리셋까지 남은 시간을 한국어 표기로. 0 단위는 생략한다. */
export function formatResetRemaining(resetsAt: string | null | undefined, now: Date): string {
  const target = parseTime(resetsAt)
  if (target === null) return t('reset.none')
  const diff = target - now.getTime()
  if (diff < 0) return t('reset.expired')
  if (diff < 60_000) return t('reset.soon')

  let remaining = Math.floor(diff / 1000)
  const days = Math.floor(remaining / 86_400)
  remaining -= days * 86_400
  const hours = Math.floor(remaining / 3_600)
  remaining -= hours * 3_600
  const minutes = Math.floor(remaining / 60)

  const parts: string[] = []
  if (days > 0) parts.push(t('time.days', { n: days }))
  if (hours > 0) parts.push(t('time.hours', { n: hours }))
  if (minutes > 0) parts.push(t('time.minutes', { n: minutes }))
  return t('reset.after', { time: parts.join(' ') })
}

/** 마지막 성공 시각의 나이. `2분 전`, `1시간 25분 전`, `2일 전` 형태. */
export function formatAge(iso: string | null | undefined, now: Date): string {
  const target = parseTime(iso)
  if (target === null) return t('age.unknown')
  const diff = Math.max(0, now.getTime() - target)
  if (diff < 60_000) return t('age.justNow')

  let remaining = Math.floor(diff / 1000)
  const days = Math.floor(remaining / 86_400)
  remaining -= days * 86_400
  const hours = Math.floor(remaining / 3_600)
  remaining -= hours * 3_600
  const minutes = Math.floor(remaining / 60)

  if (days > 0) return t('age.days', { n: days })
  if (hours > 0) return minutes > 0 ? t('age.hoursMinutes', { hours, minutes }) : t('age.hours', { n: hours })
  return t('age.minutes', { n: minutes })
}
