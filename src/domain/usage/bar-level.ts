import type { BarLevel } from '../../../shared/usage-policy.ts'
export type { BarLevel } from '../../../shared/usage-policy.ts'
export { barLevelOf } from '../../../shared/usage-policy.ts'
import { t } from '@shared/messages'

/** 색만으로 구분하지 않도록 각 단계의 안내 문구. */
export const BAR_LEVEL_TEXT: Record<BarLevel, string> = {
  neutral: t('bar.neutral'),
  ok: t('bar.ok'),
  caution: t('bar.caution'),
  danger: t('bar.danger'),
}
