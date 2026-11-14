import { usageProviderIds } from '@app/usage/provider-meta'
import { PaceChips } from '@ui/usage/PaceChips'
import { UsageSection } from '@ui/usage/UsageSection'
import { UsageSummary } from '@ui/usage/UsageSummary'

export default function App() {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight">
            <img src="/icon-192.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
            <span>Zzik : AI 사용량 대시보드</span>
          </h1>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PaceChips />
        <UsageSummary />
        {usageProviderIds().map((provider) => (
          <UsageSection key={provider} provider={provider} />
        ))}
      </main>
    </div>
  )
}
