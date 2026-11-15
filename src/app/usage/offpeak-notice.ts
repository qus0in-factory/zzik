import { t } from '@shared/messages'
import { offpeakStateOf } from '@domain/usage/offpeak'
import type { OffpeakSchedule } from '@domain/usage/offpeak'
import { USAGE_PROVIDER_META } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'
import { timeText } from './usage-text'

export interface OffpeakNotice {
  active: boolean
  text: string
  description: string
}

export function offpeakNoticeOf(
  provider: UsageProvider,
  schedule: OffpeakSchedule,
  now: Date,
  options?: { timeZone?: string },
): OffpeakNotice | null {
  const state = offpeakStateOf(schedule[provider], now)
  if (!state) return null
  const iso = state.active ? state.endsAt : state.startsAt
  const date = new Date(iso)
  let time = timeText(iso, options?.timeZone)
  if (date.getTime() - now.getTime() >= 86_400_000) {
    time = t('offpeak.time.weekday', {
      weekday: date.toLocaleDateString('ko-KR', { weekday: 'short', timeZone: options?.timeZone }),
      time,
    })
  }
  const description = t(state.active ? 'offpeak.description.active' : 'offpeak.description.upcoming', {
    provider: USAGE_PROVIDER_META[provider].title, time,
  })
  return {
    active: state.active,
    text: t(state.active ? 'offpeak.active' : 'offpeak.upcoming', { time }),
    description: provider === 'opencode' || provider === 'ollama' ? t('offpeak.description.discount', { description }) : description,
  }
}
