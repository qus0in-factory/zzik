import './activity-gerbil.css'
import type { CSSProperties, ReactNode } from 'react'
import { Badge } from '@ui/components/ui/badge'
import { Card, CardContent, CardHeader } from '@ui/components/ui/card'
import { Progress } from '@ui/components/ui/progress'
import type { UsageLevel } from '@domain/usage/types'
import type { CardPresentation } from '@app/usage/card-presentation'
import { GerbilSvg, SleepingGerbilSvg } from './GerbilSvg'

/** 판정 결과가 없을 때(정적 렌더) 쓰는 기본값: 중립 막대, 자는 저빌, 배지 없음. */
const NO_PRESENTATION: CardPresentation = { barLevel: 'neutral', barLevelText: '', gerbil: { mode: 'sleeping', lapSeconds: null } }

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

/** 배지는 막대 단계(barLevel)와 같은 판정에서 나온다. 여유·중립은 배지 없이 aria 문구로만 전달한다. */
function badgeFor(barLevel: CardPresentation['barLevel'], usedPercent: number | null): { text: string; variant: 'secondary' | 'destructive' } | null {
  if (barLevel === 'caution') return { text: '주의', variant: 'secondary' }
  if (barLevel === 'danger') return { text: usedPercent !== null && usedPercent >= 100 ? '한도 도달' : '위험', variant: 'destructive' }
  return null
}

/**
 * 한도 카드: 라벨·원래 키·퍼센트·진행률·배지·리셋 문구. 판정 없이 뷰 모델을 그린다.
 * 제목 단계는 섹션 구조(제공자 h2 → 블록 h3 → 카드 h4)에 맞춰 주입한다.
 */
export function LimitCard({ item, titleLevel = 3, presentation = NO_PRESENTATION }: { item: UsageLimitItem; titleLevel?: 3 | 4; presentation?: CardPresentation }): ReactNode {
  const { id, label, unknown = false, usedPercent, expired, resetText, elapsedPercent } = item
  const percentText = usedPercent === null ? null : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(usedPercent)
  const { barLevel, barLevelText, gerbil } = presentation
  const badge = badgeFor(barLevel, usedPercent)
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
            <span aria-label={`${percentText}퍼센트`} className="text-2xl leading-none font-semibold tabular-nums">
              {percentText}%
            </span>
          )}
          {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
          {expired && <span className="text-xs text-muted-foreground">리셋 지남</span>}
        </div>
        {usedPercent !== null && (
          <div data-testid="usage-bar" data-bar-level={barLevel} className="usage-bar relative min-w-0 pt-5">
            <div aria-hidden="true" className="activity-gerbil-track">
                <span
                  data-testid="activity-gerbil"
                  data-gerbil-state={gerbil.mode}
                  className="activity-gerbil-runner"
                  style={
                    {
                      left: gerbil.mode === 'sleeping' ? '0%' : `${Math.max(0, Math.min(100, usedPercent))}%`,
                      ...(gerbil.lapSeconds !== null ? { '--gerbil-lap': `${gerbil.lapSeconds}s` } : {}),
                    } as CSSProperties
                  }
                >
                  {gerbil.mode === 'sleeping' ? <SleepingGerbilSvg className="activity-gerbil-svg" /> : <GerbilSvg className="activity-gerbil-svg" />}
                </span>
              </div>
            {elapsedPercent != null && <span aria-hidden="true" className="absolute bottom-0 z-10 h-2 border-l-2 border-foreground" style={{ left: `${elapsedPercent}%`, transform: 'translateX(-50%)' }} />}
            <Progress value={Math.min(usedPercent, 100)} aria-label={barLevelText === '' ? `${label} 사용률` : `${label} 사용률, 상태 ${barLevelText}`}
              aria-valuetext={barLevelText === '' ? undefined : `${percentText}퍼센트, ${barLevelText}`} />
          </div>
        )}
        {elapsedPercent != null && <p className="text-xs text-muted-foreground">기간 경과 {Math.round(elapsedPercent)}%</p>}
        {resetText !== undefined && <p className="break-words text-xs text-muted-foreground">{resetText}</p>}
      </CardContent>
    </Card>
  )
}
