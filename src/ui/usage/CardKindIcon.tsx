import type { ReactNode } from 'react'
import { CalendarDays, CalendarRange, CircleHelp, Coins, Cpu, Timer } from 'lucide-react'
import type { CardKind } from '@app/usage/card-kind'

const ICONS = { short: Timer, weekly: CalendarDays, monthly: CalendarRange, model: Cpu, extra: Coins, unknown: CircleHelp } as const

/** 한도 카드 제목 앞 픽토그램: 장식이라 aria-hidden, 16px, muted 색. 종류 판정은 app(cardKindOf). */
export function CardKindIcon({ kind }: { kind: CardKind }): ReactNode {
  const Icon = ICONS[kind]
  return <Icon data-testid="card-kind-icon" data-kind={kind} aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
}
