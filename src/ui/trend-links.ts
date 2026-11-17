import type { MessageKey } from '@shared/messages'

/** `/trend` 외부 링크의 정본. 이름·도메인·한 줄 설명은 shared/messages 키로, URL은 이 한 곳에서만 관리한다. */
export const TREND_LINKS = [
  { nameKey: 'trend.link.artificialAnalysis', domainKey: 'trend.domain.artificialAnalysis', descriptionKey: 'trend.linkDesc.artificialAnalysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
  { nameKey: 'trend.link.cognitionFrontierCode', domainKey: 'trend.domain.cognitionFrontierCode', descriptionKey: 'trend.linkDesc.cognitionFrontierCode', url: 'https://cognition.com/frontiercode' },
  { nameKey: 'trend.link.arenaLeaderboard', domainKey: 'trend.domain.arenaLeaderboard', descriptionKey: 'trend.linkDesc.arenaLeaderboard', url: 'https://arena.ai/leaderboard' },
  { nameKey: 'trend.link.openRouterRankings', domainKey: 'trend.domain.openRouterRankings', descriptionKey: 'trend.linkDesc.openRouterRankings', url: 'https://openrouter.ai/rankings' },
  { nameKey: 'trend.link.openCodeData', domainKey: 'trend.domain.openCodeData', descriptionKey: 'trend.linkDesc.openCodeData', url: 'https://opencode.ai/ko/data' },
] as const satisfies readonly { nameKey: MessageKey; domainKey: MessageKey; descriptionKey: MessageKey; url: string }[]
