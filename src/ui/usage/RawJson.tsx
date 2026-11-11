import type { ReactNode } from 'react'
import { useState } from 'react'
import type { RawUsage } from '@domain/usage/types'

/** 원본 JSON 보기: 접힘으로 시작, 펼치면 원문(2칸 들여쓰기)과 복사 버튼. */
export function RawJson({ raw }: { raw: RawUsage | null }): ReactNode {
  const [open, setOpen] = useState(false)
  const text = raw === null ? 'null' : JSON.stringify(raw, null, 2)
  const copy = (): void => {
    try {
      void navigator.clipboard?.writeText(text)?.catch(() => {})
    } catch {
      /* 클립보드를 쓸 수 없으면 조용히 넘어간다 */
    }
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
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
          aria-label="원본 JSON"
          className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"
        >
          {text}
        </pre>
      )}
    </div>
  )
}
