/**
 * 사용량 항목 id → 화면 라벨 (시나리오 C9·C10).
 * 알려진 키는 고정 표, `seven_day_<slug>`/`five_hour_<slug>`는 패턴 파생,
 * 그 밖은 id 원문. 파생·원문 라벨은 unknown: true로 스키마 변경을 알린다.
 */
import { t } from '@shared/messages'

export interface UsageLabel {
  label: string
  unknown: boolean
}

const LABELS: Record<string, string> = {
  five_hour: t('label.window.fiveHour'),
  seven_day_fable: t('label.weekly.fable'),
  seven_day: t('label.window.weekly'),
  seven_day_opus: t('label.weekly.opus'),
  seven_day_sonnet: t('label.weekly.sonnet'),
  seven_day_oauth_apps: t('label.weekly.oauthApps'),
  seven_day_cowork: t('label.weekly.cowork'),
  extra_usage: t('label.extraUsage'),
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function slugText(slug: string): string {
  return slug
    .split('_')
    .filter((part) => part.length > 0)
    .map(capitalize)
    .join(' ')
}

export function usageLabelFor(id: string): UsageLabel {
  const known = LABELS[id]
  if (known !== undefined) return { label: known, unknown: false }
  if (id.startsWith('seven_day_')) return { label: t('label.weekly.other', { name: slugText(id.slice('seven_day_'.length)) }), unknown: true }
  if (id.startsWith('five_hour_')) return { label: t('label.fiveHour.other', { name: slugText(id.slice('five_hour_'.length)) }), unknown: true }
  return { label: id, unknown: true }
}
