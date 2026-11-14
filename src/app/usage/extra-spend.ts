import type { ExtraSpend } from '@domain/usage/types'
import { t } from '@shared/messages'
export interface ExtraSpendView {
  title: string
  badges: { text: string; danger: boolean }[]
  detail: string
}
/** Amount and currency are deliberately absent until their units are verified. */
export function extraSpendPresentation(spend: ExtraSpend | null | undefined): ExtraSpendView | null {
  if (spend == null) return null
  return {
    title: t('extraSpend.title'),
    badges: [
      { text: spend.enabled === null ? t('extraSpend.unknownState') : spend.enabled ? t('extraSpend.active') : t('extraSpend.inactive'), danger: false },
      ...(spend.limitReached === true ? [{ text: t('extraSpend.reached'), danger: true }] : []),
    ],
    detail: spend.usedPercent === null ? t('extraSpend.noInfo') : t('extraSpend.percent', { percent: new Intl.NumberFormat('ko-KR', {maximumFractionDigits:1}).format(spend.usedPercent) }),
  }
}
