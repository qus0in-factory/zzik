import type { AaTrendGateway } from '@domain/trend/aa-gateway'
import type { AaTrendModelItem, AaTrendResponse } from '@shared/trend-contract'

const FIXTURE_ITEMS: AaTrendModelItem[] = [
  { slug: 'claude-fable-5-2', name: 'Claude Fable 5.2', creator: 'Anthropic', intelligenceIndex: 89.4, priceIn: 3.0, priceOut: 15.0, outputTokensPerSecond: 78.2, timeToFirstTokenSeconds: 1.05, releaseDate: '2026-11-12' },
  { slug: 'gpt-5-4-pro', name: 'GPT-5.4 Pro', creator: 'OpenAI', intelligenceIndex: 88.1, priceIn: 5.0, priceOut: 20.0, outputTokensPerSecond: 64.0, timeToFirstTokenSeconds: 1.42, releaseDate: '2026-11-05' },
  { slug: 'gemini-3-5-pro', name: 'Gemini 3.5 Pro', creator: 'Google', intelligenceIndex: 86.7, priceIn: 1.25, priceOut: 5.0, outputTokensPerSecond: 112.4, timeToFirstTokenSeconds: 0.78, releaseDate: '2026-11-01' },
  { slug: 'deepseek-v4-1', name: 'DeepSeek V4.1', creator: 'DeepSeek', intelligenceIndex: 84.9, priceIn: 0.27, priceOut: 1.1, outputTokensPerSecond: 94.5, timeToFirstTokenSeconds: 0.91, releaseDate: '2026-10-28' },
  { slug: 'qwen4-max', name: 'Qwen4 Max', creator: 'Qwen', intelligenceIndex: 83.2, priceIn: 0.15, priceOut: 0.6, outputTokensPerSecond: 128.0, timeToFirstTokenSeconds: 0.68, releaseDate: '2026-11-12' },
  { slug: 'claude-fable-5-sonnet', name: 'Claude Fable 5 Sonnet', creator: 'Anthropic', intelligenceIndex: 82.0, priceIn: 1.5, priceOut: 7.5, outputTokensPerSecond: 98.3, timeToFirstTokenSeconds: 0.74, releaseDate: '2026-10-15' },
  { slug: 'grok-4-2', name: 'Grok 4.2', creator: 'xAI', intelligenceIndex: 80.5, priceIn: 2.0, priceOut: 10.0, outputTokensPerSecond: 88.7, timeToFirstTokenSeconds: 0.96, releaseDate: '2026-10-20' },
  { slug: 'glm-5-3', name: 'GLM 5.3', creator: 'Zhipu AI', intelligenceIndex: 78.6, priceIn: 0.2, priceOut: 0.8, outputTokensPerSecond: 136.2, timeToFirstTokenSeconds: 0.62, releaseDate: '2026-10-10' },
  { slug: 'gemini-3-5-flash', name: 'Gemini 3.5 Flash', creator: 'Google', intelligenceIndex: 76.4, priceIn: 0.08, priceOut: 0.3, outputTokensPerSecond: 245.8, timeToFirstTokenSeconds: 0.31, releaseDate: '2026-11-04' },
  { slug: 'gpt-5-4-mini', name: 'GPT-5.4 Mini', creator: 'OpenAI', intelligenceIndex: 75.1, priceIn: 0.12, priceOut: 0.48, outputTokensPerSecond: 192.4, timeToFirstTokenSeconds: 0.42, releaseDate: '2026-11-02' },
  { slug: 'hy4-flash', name: 'HY4 Flash', creator: 'Tencent', intelligenceIndex: 72.3, priceIn: 0.1, priceOut: 0.4, outputTokensPerSecond: 274.1, timeToFirstTokenSeconds: 0.28, releaseDate: '2026-11-11' },
  { slug: 'llama-5-8b', name: 'Llama 5 8B', creator: 'Meta', intelligenceIndex: 66.8, priceIn: 0.05, priceOut: 0.2, outputTokensPerSecond: 340.6, timeToFirstTokenSeconds: 0.21, releaseDate: '2026-11-08' },
]

export const AA_TREND_FIXTURE: AaTrendResponse = {
  day: '2026-11-14',
  indexVersion: '5.0',
  attribution: 'Source: Artificial Analysis (artificialanalysis.ai)',
  intelligenceTop: [...FIXTURE_ITEMS].sort((a, b) => b.intelligenceIndex - a.intelligenceIndex).slice(0, 10),
  priceLowest: [...FIXTURE_ITEMS].sort((a, b) => (a.priceOut ?? 0) - (b.priceOut ?? 0)).slice(0, 10),
  priceHighest: [...FIXTURE_ITEMS].sort((a, b) => (b.priceOut ?? 0) - (a.priceOut ?? 0)).slice(0, 10),
  speedHighest: [...FIXTURE_ITEMS].sort((a, b) => (b.outputTokensPerSecond ?? 0) - (a.outputTokensPerSecond ?? 0)).slice(0, 10),
  latencyLowest: [...FIXTURE_ITEMS].sort((a, b) => (a.timeToFirstTokenSeconds ?? 0) - (b.timeToFirstTokenSeconds ?? 0)).slice(0, 10),
}

export function createFixtureAaTrendGateway(): AaTrendGateway {
  return {
    async fetchAaTrend() {
      return { ok: true, value: AA_TREND_FIXTURE }
    },
  }
}
