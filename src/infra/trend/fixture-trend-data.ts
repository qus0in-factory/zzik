/**
 * DEV 전용 트렌드 합성 데이터. `?fixture=normal` 화면과 README 스크린샷이 쓴다.
 * z-hyd(무료 모델 = OpenCode Go Free 행)와 z-hf(AA 요약 문장) 변경은 이 파일 한 곳만 고치면 된다.
 */
import {
  TREND_FREE_MODELS_RULE,
  TREND_METRICS_RULE,
  TREND_NEW_MODELS_RULE,
  TREND_OR_LICENSE_NAME,
  TREND_OR_LICENSE_URL,
  TREND_PLAN_MODELS_RULE,
  TREND_SCHEMA_VERSION,
} from '@shared/trend-contract'
import type { TrendSectionPayload } from '@shared/trend-contract'
import { t } from '@shared/messages'

const GENERATED_AT = '2026-11-14T03:00:00.000Z'
const SOURCE_AT = '2026-11-14T02:00:00.000Z'

const NEW_MODELS = {
  section: 'new-models',
  schemaVersion: TREND_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  rule: TREND_NEW_MODELS_RULE,
  sources: [
    { id: 'models.dev', fetchedAt: GENERATED_AT, status: 'ok' },
    { id: 'openrouter', fetchedAt: GENERATED_AT, status: 'ok' },
  ],
  items: [
    {
      id: 'anthropic/claude-fable-5-2', name: 'Claude Fable 5.2', creator: 'anthropic',
      releaseDate: '2026-11-12', precision: 'day', price: { input: 3, output: 15 },
      free: false, openWeights: false, providers: ['anthropic', 'openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'qwen/qwen4-max', name: 'Qwen4 Max', creator: 'qwen',
      releaseDate: '2026-11-12', precision: 'day', price: { input: 0.15, output: 0.6 },
      free: false, openWeights: true, providers: ['ollama-cloud', 'openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'tencent/hy4-flash', name: 'HY4 Flash', creator: 'tencent',
      releaseDate: '2026-11-11', precision: 'day', price: { input: 0.1, output: 0.4 },
      free: false, openWeights: true, providers: ['openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'deepseek/deepseek-v4.1-mini', name: 'DeepSeek V4.1 Mini', creator: 'deepseek',
      releaseDate: '2026-11-11', precision: 'day', price: { input: 0.12, output: 0.48 },
      free: false, openWeights: true, providers: ['deepseek', 'openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'google/gemini-3.5-nano', name: 'Gemini 3.5 Nano', creator: 'google',
      releaseDate: '2026-11-10', precision: 'day', price: { input: 0.08, output: 0.3 },
      free: false, openWeights: false, providers: ['google', 'openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'openai/gpt-5.4-nano', name: 'GPT-5.4 Nano', creator: 'openai',
      releaseDate: '2026-11-10', precision: 'day', price: { input: 0.1, output: 0.4 },
      free: false, openWeights: false, providers: ['openai', 'openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'mistral/mistral-small-4', name: 'Mistral Small 4', creator: 'mistral',
      releaseDate: '2026-11-09', precision: 'day', price: { input: 0.15, output: 0.5 },
      free: false, openWeights: true, providers: ['openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'zhipuai/glm-5.3-lite', name: 'GLM 5.3 Lite', creator: 'zhipuai',
      releaseDate: '2026-11-09', precision: 'day', price: { input: 0.09, output: 0.35 },
      free: false, openWeights: true, providers: ['openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
    {
      id: 'meta-llama/llama-5-8b', name: 'Llama 5 8B', creator: 'meta',
      releaseDate: '2026-11-08', precision: 'day', price: { input: 0.05, output: 0.2 },
      free: false, openWeights: true, providers: ['openrouter'], links: {},
      registeredIn: ['openrouter'],
    },
  ],
} satisfies TrendSectionPayload

const FREE_MODELS = {
  section: 'free-models',
  schemaVersion: TREND_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  rule: TREND_FREE_MODELS_RULE,
  sources: [{ id: 'go-models', fetchedAt: GENERATED_AT, status: 'ok' }],
  items: [
    {
      id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017', creator: 'deepseek',
      releaseDate: '2026-10-17', precision: 'day', price: { input: 0, output: 0 },
      free: true, openWeights: true, providers: ['go-models'],
      links: { opencode: 'https://opencode.ai/docs/console/go/#pricing' },
      freeKind: 'opencode-go', recentlyAdded: true, limitedTime: true, limitedRegions: false,
    },
    {
      id: 'zhipuai/glm-5.3', name: 'GLM 5.3', creator: 'zhipuai',
      releaseDate: '2026-08-14', precision: 'day', price: { input: 0, output: 0 },
      free: true, openWeights: true, providers: ['go-models'],
      links: { opencode: 'https://opencode.ai/docs/console/go/#pricing' },
      freeKind: 'opencode-go', recentlyAdded: false, limitedTime: false, limitedRegions: true,
    },
    {
      id: 'qwen/qwen4-max', name: 'Qwen4 Max', creator: 'qwen',
      releaseDate: '2026-11-05', precision: 'day', price: { input: 0, output: 0 },
      free: true, openWeights: true, providers: ['go-models'],
      links: { opencode: 'https://opencode.ai/docs/console/go/#pricing' },
      freeKind: 'opencode-go', recentlyAdded: true, limitedTime: true, limitedRegions: true,
    },
  ],
} satisfies TrendSectionPayload

const METRICS = {
  section: 'metrics',
  schemaVersion: TREND_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  rule: TREND_METRICS_RULE,
  sources: [{ id: 'openrouter-rankings', fetchedAt: GENERATED_AT, status: 'ok' }],
  items: [],
  aaCitation: t('trend.fixture.aaCitation'),
  blocks: [{
    id: 'or-usage', status: 'ok', asOf: SOURCE_AT, asOfKind: 'source',
    entries: [
      { id: 'deepseek/deepseek-v4', name: 'deepseek/deepseek-v4', creator: 'deepseek', rank: 1, rankDelta: 2, kind: 'moved', share7d: 0.6, shareDelta: 0.02 },
      { id: 'qwen/qwen4-max', name: 'qwen/qwen4-max', creator: 'qwen', rank: 2, rankDelta: -1, kind: 'moved', share7d: 0.25, shareDelta: -0.01 },
      { id: 'tencent/hy4-flash', name: 'tencent/hy4-flash', creator: 'tencent', rank: 3, rankDelta: null, kind: 'new-top', share7d: 0.08 },
    ],
    attribution: 'Source: OpenRouter (openrouter.ai/rankings), as of 2026-11-14T02:00:00Z. Licensed under CC BY 4.0.',
    license: { name: TREND_OR_LICENSE_NAME, url: TREND_OR_LICENSE_URL },
    processed: true,
  }],
} satisfies TrendSectionPayload

const PLAN_MODELS = {
  section: 'plan-models',
  schemaVersion: TREND_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  rule: TREND_PLAN_MODELS_RULE,
  sources: [
    { id: 'go-models', fetchedAt: GENERATED_AT, status: 'ok' },
    { id: 'ollama-tags', fetchedAt: GENERATED_AT, status: 'ok' },
  ],
  items: [],
  plans: [
    {
      id: 'opencode-go', status: 'ok',
      items: [{
        id: 'deepseek/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash 1017', creator: 'deepseek',
        releaseDate: '2026-10-17', precision: 'day', firstSeenAt: '2026-11-10T03:00:00.000Z',
        confidence: 'catalog', source: 'go-models', matched: true,
      }],
    },
    { id: 'grok', status: 'unavailable', note: 'unverified', items: [] },
  ],
} satisfies TrendSectionPayload

/** 계약을 만족하는 합성 섹션 모음. 모든 섹션을 한 파일에 모아 후속 변경을 쉽게 한다. */
export const TREND_FIXTURE_SECTIONS: Record<import('@shared/trend-contract').TrendSection, TrendSectionPayload> = {
  'plan-models': PLAN_MODELS,
  'new-models': NEW_MODELS,
  'free-models': FREE_MODELS,
  metrics: METRICS,
}
