import { Badge } from '@ui/components/ui/badge'
import { usageProviderIds } from '@app/usage/provider-meta'
import { UsageSection } from '@ui/usage/UsageSection'
import { UsageSummary } from '@ui/usage/UsageSummary'

export default function App() {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <span className="text-sm font-semibold tracking-tight">zzik</span>
          <Badge variant="secondary">개인 대시보드</Badge>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Hello Young-In</h1>
        <p className="mt-3 text-sm text-muted-foreground">구독 사용량을 한눈에 확인하는 공간입니다.</p>
        <UsageSummary />
        {usageProviderIds().map((provider) => (
          <UsageSection key={provider} provider={provider} />
        ))}
      </main>
    </div>
  )
}
