import type { ReactNode } from 'react'
import { t } from '@shared/messages'
import { SiteHeader } from './SiteHeader'

/** 트렌드 화면 자리. 아직 데이터를 호출하지 않고 nav와 짧은 빈 상태만 둔다. */
export function TrendPage(): ReactNode {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full flex-1 max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <p className="text-muted-foreground">{t('trend.empty')}</p>
      </main>
    </div>
  )
}
