import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/types'
import { useRawJsonOpen } from '@app/usage/usage-ui-store'

/**
 * 원본 JSON 보기: 접힘으로 시작, 펼치면 원문(2칸 들여쓰기)과 복사 버튼.
 * 펼침 상태는 제공자별로 클라이언트 Zustand 스토어에 둔다(ADR 0.3 D8, 스택 부록 A5).
 * 제공자 섹션이 둘이므로 `pre`/`region` 라벨도 제공자별로 구분한다.
 */
export function RawJson({
  raw,
  provider,
  label,
}: {
  raw: Record<string, unknown> | null
  provider: UsageProvider
  label?: string
}): ReactNode {
  const rawJson = useRawJsonOpen(provider)
  const open = rawJson.open
  const text = raw === null ? 'null' : JSON.stringify(raw, null, 2)
  const regionLabel = `원본 JSON (${label ?? provider})`
  const copy = (): void => {
    try {
      void navigator.clipboard?.writeText(text)?.catch(() => {})
    } catch {
      /* 클립보드를 쓸 수 없으면 조용히 넘어간다 */
    }
  }
  return (
    <div data-testid={`usage-raw-${provider}`} className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => rawJson.toggle()}
          className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-accent"
        >
          원본 JSON
        </button>
        {open && (
          <button type="button" onClick={copy} className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-accent">
            복사
          </button>
        )}
      </div>
      {open && (
        <pre
          role="region"
          aria-label={regionLabel}
          className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
        >
          {text}
        </pre>
      )}
    </div>
  )
}
