import type { CSSProperties, ReactNode } from 'react'
import { t } from '@shared/messages'
import type { CardKind } from '@app/usage/card-kind'
import type { CardPresentation } from '@app/usage/card-presentation'
import { Badge } from '@ui/components/ui/badge'
import { Progress } from '@ui/components/ui/progress'
import { CardKindIcon } from './CardKindIcon'
import { badgeFor } from './LimitCard'
import type { UsageLimitItem } from './LimitCard'
import { RawIdInfo } from './RawIdInfo'

/** 판정 결과가 없을 때(정적 렌더) 쓰는 기본값: 중립 막대, 배지 없음. */
const NO_PRESENTATION: Pick<CardPresentation, 'barLevel' | 'barLevelText'> = { barLevel: 'neutral', barLevelText: '' }

/** 모든 행의 높이(56px)를 같게 둔다 — 스켈레톤 행과 맞춰 로딩→ready에서 레이아웃이 움직이지 않는다. */
export const LIST_ROW_CLASS = 'h-14'

/**
 * 목록 모드의 한도 한 행: 이름(아이콘·ⓘ·미확인 배지) · 사용률+배지 · 작은 막대(기간 경과 기준선) · 기간 경과 · 리셋.
 * 640px 미만에서는 기간 경과·리셋 열을 숨기고 이름 아래 작은 글씨로 줄바꿈한다. 저빌은 목록에서 생략한다(행을 깔끔하게 유지).
 */
export function LimitRow({ item, presentation = NO_PRESENTATION, enterIndex = 0, kind = 'unknown' }: { item: UsageLimitItem; presentation?: Pick<CardPresentation, 'barLevel' | 'barLevelText'>; enterIndex?: number; kind?: CardKind }): ReactNode {
  const { id, label, unknown = false, usedPercent, expired, resetText, elapsedPercent } = item
  const percentText = usedPercent === null ? null : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(usedPercent)
  const { barLevel, barLevelText } = presentation
  const badge = badgeFor(barLevel, usedPercent)
  const elapsedText = elapsedPercent == null ? null : t('card.elapsed', { percent: Math.round(elapsedPercent) })
  return (
    <tr data-testid="usage-row" data-row-id={id} className={`fade-in ${LIST_ROW_CLASS} border-b last:border-b-0`} style={{ '--enter-index': enterIndex } as CSSProperties}>
      <th scope="row" className="min-w-0 px-3 py-2 text-left align-middle font-normal">
        <div className="flex min-w-0 items-center gap-2">
          <CardKindIcon kind={kind} />
          <span data-testid="usage-row-label" className="truncate text-sm leading-5 font-semibold">
            {label}
          </span>
          <RawIdInfo id={id} label={label} />
          {unknown && <Badge variant="outline">{t('card.unverified')}</Badge>}
        </div>
        {/* 좁은 화면: 열을 줄이는 대신 이름 아래 한 줄로 */}
        <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground sm:hidden">{[elapsedText, expired ? t('card.expired') : resetText].filter((part) => part !== null && part !== undefined).join(' · ')}</p>
      </th>
      <td className="w-14 px-1 py-2 align-middle whitespace-nowrap sm:w-32 sm:px-2">
        <div className="flex items-center gap-1.5">
          {usedPercent === null ? (
            <span className="text-sm font-semibold tabular-nums text-muted-foreground">{t('card.noValue')}</span>
          ) : (
            <span aria-label={t('card.percent.aria', { value: percentText ?? '' })} className="text-base leading-none font-semibold tabular-nums">
              {percentText}%
            </span>
          )}
          {badge && <Badge variant={badge.variant} className="hidden sm:inline-flex">{badge.text}</Badge>}
        </div>
      </td>
      <td className="w-[26%] min-w-20 px-2 py-2 align-middle">
        {usedPercent !== null && (
          <div data-testid="usage-bar" data-bar-level={barLevel} className="usage-bar relative min-w-0 py-1">
            {elapsedPercent != null && <span aria-hidden="true" className="absolute top-0 bottom-0 z-10 border-l-2 border-foreground" style={{ left: `${elapsedPercent}%`, transform: 'translateX(-50%)' }} />}
            <Progress
              value={Math.min(usedPercent, 100)}
              aria-label={barLevelText === '' ? t('card.usage.aria', { label }) : t('card.usage.aria.state', { label, state: barLevelText })}
              aria-valuetext={barLevelText === '' ? undefined : t('card.valuetext', { value: percentText ?? '', state: barLevelText })}
            />
          </div>
        )}
      </td>
      <td className="hidden w-24 px-2 py-2 align-middle text-xs whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">{elapsedPercent == null ? '' : `${Math.round(elapsedPercent)}%`}</td>
      <td className="hidden w-44 px-3 py-2 align-middle text-xs text-muted-foreground sm:table-cell">
        <span className="line-clamp-2 break-words">{expired ? t('card.expired') : (resetText ?? '')}</span>
      </td>
    </tr>
  )
}

/** 목록 모드 표(한 그룹). 의미 있는 마크업: caption(sr-only), 열 머리글 th scope="col", 행 머리글 th scope="row". */
export function LimitTable({ caption, testId, children }: { caption: string; testId?: string; children: ReactNode }): ReactNode {
  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <table data-testid={testId} className="w-full table-fixed border-collapse">
        <caption className="sr-only">{caption}</caption>
        {/* table-fixed의 열 너비는 col에서 정한다(첫 행이 숨겨진 thead라 셀 너비가 먹히지 않는다) */}
        <colgroup>
          <col />
          <col className="w-14 sm:w-32" />
          <col className="w-[26%]" />
          <col className="hidden w-24 sm:table-column" />
          <col className="hidden w-44 sm:table-column" />
        </colgroup>
        <thead className="hidden border-b bg-muted/40 text-xs text-muted-foreground sm:table-header-group">
          <tr>
            <th scope="col" className="px-3 py-1.5 text-left font-medium">{t('list.col.name')}</th>
            <th scope="col" className="w-32 px-2 py-1.5 text-left font-medium">{t('list.col.used')}</th>
            <th scope="col" className="w-[26%] px-2 py-1.5 text-left font-medium">{t('list.col.bar')}</th>
            <th scope="col" className="w-24 px-2 py-1.5 text-left font-medium">{t('list.col.elapsed')}</th>
            <th scope="col" className="w-44 px-3 py-1.5 text-left font-medium">{t('list.col.reset')}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
