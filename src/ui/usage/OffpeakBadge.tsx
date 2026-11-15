import type { ReactNode } from 'react'
import type { OffpeakNotice } from '@app/usage/offpeak-notice'
import { Badge } from '@ui/components/ui/badge'

const TONE = {
  active: 'border-[var(--usage-ok)]/40 bg-[var(--usage-ok)]/10 text-[var(--usage-ok)]',
  inactive: 'border-border text-muted-foreground',
} as const

/** off-peak 시간대 상태 배지(ADR 0.7). 판정·문구 조립은 app(offpeakNoticeOf)이 맡고 ui는 그리기만 한다. */
export function OffpeakBadge({ notice }: { notice: OffpeakNotice }): ReactNode {
  return (
    <Badge
      variant="outline"
      data-testid="offpeak-badge"
      data-active={notice.active}
      title={notice.description}
      className={notice.active ? TONE.active : TONE.inactive}
    >
      <span aria-hidden="true">{notice.text}</span>
      <span className="sr-only">{notice.description}</span>
    </Badge>
  )
}
