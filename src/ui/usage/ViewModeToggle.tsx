import type { ReactNode } from 'react'
import { LayoutGrid, List } from 'lucide-react'
import { t } from '@shared/messages'
import { useViewMode } from '@app/usage/ViewModeContext'
import type { ViewMode } from '@app/usage/view-mode'

const OPTIONS = [
  { mode: 'grid', Icon: LayoutGrid, label: 'view.grid' },
  { mode: 'list', Icon: List, label: 'view.list' },
] as const satisfies readonly { mode: ViewMode; Icon: typeof List; label: 'view.grid' | 'view.list' }[]

/** 카드(2열) ↔ 목록(테이블 행) 전환: 아이콘 토글 두 개(aria-pressed). 전역 설정 하나이며 브라우저별로 저장된다. */
export function ViewModeToggle(): ReactNode {
  const { mode, setMode } = useViewMode()
  return (
    <div role="group" aria-label={t('view.group.aria')} className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {OPTIONS.map(({ mode: option, Icon, label }) => (
        <button
          key={option}
          type="button"
          data-testid={`view-mode-${option}`}
          aria-pressed={mode === option}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => setMode(option)}
          className="motion-button inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
        >
          <Icon aria-hidden="true" className="size-3" />
        </button>
      ))}
    </div>
  )
}
