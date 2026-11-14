import antigravity from '../../../tests/fixtures/usage-history/antigravity.samples.json'
import claude from '../../../tests/fixtures/usage-history/claude.samples.json'
import codex from '../../../tests/fixtures/usage-history/codex.samples.json'
import grok from '../../../tests/fixtures/usage-history/grok.samples.json'
import ollama from '../../../tests/fixtures/usage-history/ollama.samples.json'
import opencode from '../../../tests/fixtures/usage-history/opencode.samples.json'
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract'
import type { UsageHistoryPage, UsageHistorySummaryEntry } from '../../../shared/usage-history-contract'
import { decodeHistoryPage } from '@domain/usage/history/decode-history'
import type { UsageHistoryGateway } from '@domain/usage/history/ports'
import { USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider } from '@domain/usage/providers'

const FIXTURES: Record<UsageProvider, unknown> = { claude, codex, antigravity, opencode, grok, ollama }

/**
 * 합성 표본 픽스처로 만든 이력 게이트웨이(DEV 목 모드, T1 API 없이 개발). 첫 요청은 픽스처 쪽을 그대로 돌려주고
 * `after`가 붙은 이어받기는 빈 쪽을 돌려준다. 쿼리의 범위는 따지지 않는다.
 */
export function createFixtureUsageHistoryGateway(): UsageHistoryGateway {
  const pages = new Map<UsageProvider, UsageHistoryPage>()
  for (const provider of USAGE_PROVIDERS) {
    const decoded = decodeHistoryPage(FIXTURES[provider], provider)
    if (decoded.ok) pages.set(provider, decoded.page)
  }
  return {
    async fetchSummary() {
      const summary: UsageHistorySummaryEntry[] = USAGE_PROVIDERS.map((provider) => {
        const oks = (pages.get(provider)?.samples ?? []).filter((sample) => sample.status === 'ok')
        const lastOkAt = oks.at(-1)?.runAt ?? null
        // 합성 표본은 몇 시간 분량뿐이라, 4건 이상이면 DEV에서 차트를 열어 볼 수 있게 첫 ok를 하루 앞으로 둔다(요약만 — 표본은 그대로).
        const firstOkAt = oks.length >= 4 && lastOkAt !== null ? new Date(Date.parse(lastOkAt) - 86_400_000).toISOString() : (oks[0]?.runAt ?? null)
        return { provider, okCount: Math.min(oks.length, 4), firstOkAt, lastOkAt }
      })
      return { ok: true, summary }
    },
    async fetchSamples(provider, query) {
      const page = pages.get(provider)
      if (page === undefined) return { ok: false, reason: 'api_error', message: 'not_found' }
      if (query.after !== undefined) return { ok: true, page: { provider, scanVersion: USAGE_HISTORY_SCAN_VERSION, samples: [], anchor: null, nextCursor: query.after, hasMore: false } }
      return { ok: true, page: structuredClone({ ...page, hasMore: false }) }
    },
  }
}
