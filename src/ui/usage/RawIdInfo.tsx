import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { t } from '@shared/messages'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@ui/components/ui/tooltip'

/**
 * 카드 제목 옆 작은 정보 아이콘: 원본 속성 이름(five_hour 등)을 툴팁으로 보여 준다.
 * 호버·포커스로 열리고, 터치에서는 탭으로 열고 바깥 탭으로 닫는다(Radix Tooltip을 controlled로 쓰고 클릭을 토글로 처리).
 * 스크린리더에는 항상 읽히는 sr-only 문구를 aria-describedby로 연결한다.
 */
export function RawIdInfo({ id, label }: { id: string; label: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const descriptionId = useId()
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="usage-card-info"
            aria-label={t('card.info.aria', { label })}
            aria-describedby={descriptionId}
            onClick={(event) => {
              event.preventDefault() // Radix의 클릭 닫기 대신 토글한다(터치에서 탭으로 열기)
              setOpen((current) => !current)
            }}
            className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full before:absolute before:-inset-1.5 before:content-[''] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Info aria-hidden="true" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent data-testid="usage-card-info-content">{id}</TooltipContent>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {id}
      </span>
    </TooltipProvider>
  )
}
