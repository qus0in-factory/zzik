import type { UsageLabel } from './labels'
import { t } from '@shared/messages'
/** Provisional until G2b live KV verification; never infer unobserved periods. */
const WINDOWS: Record<string, { label: string; seconds: number }> = {
  '5h': { label: t('label.window.fiveHour'), seconds: 18000 },
  weekly: { label: t('label.window.weekly'), seconds: 604800 },
}
/** 카드 제목이 길어지지 않도록 알려진 그룹명만 줄인다. 모르는 그룹은 응답 그대로. */
const GROUP_LABELS: Record<string, string> = {
  'gemini models': 'Gemini',
  'claude and gpt models': 'Claude·GPT',
  'gemini 4 argon': 'Argon',
}
export function antigravityGroupLabel(group: string): string {
  return GROUP_LABELS[group.trim().toLowerCase()] ?? group
}
export function antigravityCycleSeconds(window: string): number | null {
  return Object.hasOwn(WINDOWS, window) ? WINDOWS[window].seconds : null
}
export function antigravityLabel(group: string, window: string): UsageLabel {
  const known = Object.hasOwn(WINDOWS, window) ? WINDOWS[window] : undefined
  return { label: antigravityGroupLabel(group) + ' · ' + (known?.label ?? t('label.window.named', { name: window })), unknown: known === undefined }
}
