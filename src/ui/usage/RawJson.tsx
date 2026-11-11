import type { ReactNode } from 'react'
import type { UsageProvider } from '@domain/usage/providers'
import type { UsageReport } from '@domain/usage/types'
import { useRawJsonOpen } from '@app/usage/usage-ui-store'

/**
 * 원본 JSON 보기: 접힘으로 시작, 펼치면 원문(2칸 들여쓰기)과 복사 버튼.
 * 펼침 상태는 제공자별로 클라이언트 Zustand 스토어에 둔다(ADR 0.3 D8, 스택 부록 A5).
 * 식별자를 가린 봉투(`rawRedacted`)면 가린 개수를 알린다(H3) — 가린 값 자체는 보여 주지 않는다.
 */
export function RawJson({
  raw,
  provider,
  label,
  rawRedacted = null,
}: {
  raw: Record<string, unknown> | null
  provider: UsageProvider
  label?: string
  rawRedacted?: readonly string[] | null
}): ReactNode {
  const rawJson = useRawJsonOpen(provider)
  const open = rawJson.open
  const text = raw === null ? 'null' : JSON.stringify(raw, null, 2)
  const regionLabel = `원본 JSON (${label ?? provider})`
  const redactedCount = rawRedacted?.length ?? 0
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
      {redactedCount > 0 && (
        <p data-testid={`usage-raw-redacted-${provider}`} className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
          값 {redactedCount}개를 가렸습니다
        </p>
      )}
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
