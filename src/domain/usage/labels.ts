/**
 * 사용량 항목 id → 화면 라벨 (시나리오 C9·C10).
 * 알려진 키는 고정 표, `seven_day_<slug>`/`five_hour_<slug>`는 패턴 파생,
 * 그 밖은 id 원문. 파생·원문 라벨은 unknown: true로 스키마 변경을 알린다.
 */

export interface UsageLabel {
  label: string
  unknown: boolean
}

const LABELS: Record<string, string> = {
  five_hour: '5시간 한도',
  seven_day_fable: 'Fable 주간',
  seven_day: '주간 한도',
  seven_day_opus: 'Opus 주간',
  seven_day_sonnet: 'Sonnet 주간',
  seven_day_oauth_apps: 'OAuth 앱 주간',
  seven_day_cowork: 'Cowork 주간',
  extra_usage: '추가 사용량',
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
  if (id.startsWith('seven_day_')) return { label: `주간 · ${slugText(id.slice('seven_day_'.length))}`, unknown: true }
  if (id.startsWith('five_hour_')) return { label: `5시간 · ${slugText(id.slice('five_hour_'.length))}`, unknown: true }
  return { label: id, unknown: true }
}
