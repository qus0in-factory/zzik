import './activity-cat.css'
import type { ReactNode } from 'react'
import { Badge } from '@ui/components/ui/badge'
import { Card, CardContent, CardHeader } from '@ui/components/ui/card'
import { Progress } from '@ui/components/ui/progress'
import type { UsageLevel } from '@domain/usage/types'

export interface UsageLimitItem {
  id: string
  label: string
  unknown?: boolean
  elapsedPercent?: number | null
  usedPercent: number | null
  resetsAt: string | null
  expired: boolean
  status: UsageLevel
  /** domain 계산 표시 문구(리셋까지 남은 시간 등) */
  resetText?: string
}

const THRESHOLD_BADGE: Partial<Record<UsageLevel, { text: string; variant: 'secondary' | 'destructive' }>> = {
  warn: { text: '주의', variant: 'secondary' },
  limit: { text: '한도 도달', variant: 'destructive' },
}

/**
 * 한도 카드: 라벨·원래 키·퍼센트·진행률·배지·리셋 문구. 판정 없이 뷰 모델을 그린다.
 * 제목 단계는 섹션 구조(제공자 h2 → 블록 h3 → 카드 h4)에 맞춰 주입한다.
 */
export function LimitCard({ item, titleLevel = 3, lapSeconds = null }: { item: UsageLimitItem; titleLevel?: 3 | 4; lapSeconds?: number | null }): ReactNode {
  const { id, label, unknown = false, usedPercent, expired, status, resetText, elapsedPercent } = item
  const badge = THRESHOLD_BADGE[status]
  const Heading = titleLevel === 4 ? 'h4' : 'h3'
  return (
    <Card data-testid="usage-card" data-card-id={id} className="min-w-0 gap-3">
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Heading data-testid="usage-card-label" className="break-words text-base leading-none font-semibold">
            {label}
          </Heading>
          <code className="break-all text-xs text-muted-foreground">{id}</code>
          {unknown && <Badge variant="outline">미확인</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {usedPercent === null ? (
            <span className="text-2xl leading-none font-semibold tabular-nums text-muted-foreground">정보 없음</span>
          ) : (
            <span aria-label={`${usedPercent}퍼센트`} className="text-2xl leading-none font-semibold tabular-nums">
              {usedPercent}%
            </span>
          )}
          {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
          {expired && <span className="text-xs text-muted-foreground">리셋 지남</span>}
        </div>
        {lapSeconds !== null && <div aria-hidden="true" className="activity-cat-track"><span className="activity-cat-runner" style={{ animationDuration: lapSeconds + 's' }}><span className="activity-cat-body">🐈</span></span></div>}
        {usedPercent !== null && (
          <div className="relative min-w-0">
            {elapsedPercent != null && <span aria-hidden="true" className="absolute z-10 h-full border-l-2 border-foreground" style={{ left: `${elapsedPercent}%`, transform: 'translateX(-50%)' }} />}
            <Progress value={Math.min(usedPercent, 100)} aria-label={`${label} 사용률`} />
          </div>
        )}
        {elapsedPercent != null && <p className="text-xs text-muted-foreground">기간 경과 {Math.round(elapsedPercent)}%</p>}
        {resetText !== undefined && <p className="break-words text-xs text-muted-foreground">{resetText}</p>}
      </CardContent>
    </Card>
  )
}
