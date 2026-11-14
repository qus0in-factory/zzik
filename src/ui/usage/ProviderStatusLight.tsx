import type { ReactNode } from 'react'
import type { ProviderStatus } from '@app/usage/provider-status'

const COLOR: Record<ProviderStatus['level'], string> = {
  ok: 'bg-[var(--usage-ok)]',
  caution: 'bg-[var(--usage-caution)]',
  danger: 'bg-[var(--usage-danger)]',
  neutral: 'bg-[var(--usage-neutral)]',
}

/** 연결 상태등: 색 + sr-only 문구 + 툴팁으로 색만으로 구분하지 않게 한다. 판정은 app(providerStatusOf). */
export function ProviderStatusLight({ status }: { status: ProviderStatus }): ReactNode {
  return (
    <span data-testid="provider-status" data-level={status.level} title={status.description} className="inline-flex items-center">
      <span aria-hidden="true" className={`size-2.5 rounded-full transition-colors duration-200 motion-reduce:transition-none ${COLOR[status.level]}`} />
      <span className="sr-only">{status.description}</span>
    </span>
  )
}
