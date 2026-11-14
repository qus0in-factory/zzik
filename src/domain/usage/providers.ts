import { t } from '@shared/messages'
import { buildAntigravityUsageView } from './antigravity-view'
import { buildCodexUsageView } from './codex-view'
import { buildGrokUsageView } from './grok-view'
import { buildOllamaUsageView } from './ollama-view'
import { buildOpencodeUsageView } from './opencode-view'
import type { UsageReport } from './types'
import { buildUsageView } from './view'

/**
 * 제공자 등록부 (ADR 0.3 D8).
 * 프론트가 아는 제공자 목록, 화면 메타데이터, 제공자별 뷰 생성기를 한 곳에 둔다.
 * 화면 컴포넌트는 제공자별 분기를 갖지 않고 이 등록부만 본다.
 */

export const USAGE_PROVIDERS = ['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'] as const

export type UsageProvider = (typeof USAGE_PROVIDERS)[number]

export function isUsageProvider(value: unknown): value is UsageProvider {
  return typeof value === 'string' && (USAGE_PROVIDERS as readonly string[]).includes(value)
}

export interface UsageProviderMeta {
  id: UsageProvider
  title: string
  metricsTitle: string
  /** 갱신을 맡는 클라이언트 이름(안내 문구에 쓴다). */
  clientName: string
  refreshHint: string
  /** 수집 상태가 `network_error`일 때 수집기 측 제공자 연결을 안내하는 문구. */
  networkErrorNote?: string
  sectionId: string
  ariaLabel: string
}

export const USAGE_PROVIDER_META: Record<UsageProvider, UsageProviderMeta> = {
  antigravity: {
    id: 'antigravity',
    title: t('provider.antigravity.title'),
    metricsTitle: t('section.metrics.extra'),
    clientName: 'Antigravity',
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-antigravity',
    ariaLabel: t('provider.antigravity.ariaLabel'),
  },
  claude: {
    id: 'claude',
    title: t('provider.claude.title'),
    metricsTitle: t('section.metrics.model'),
    clientName: 'Claude Code',
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-claude',
    ariaLabel: t('provider.claude.ariaLabel'),
  },
  grok: {
    id: 'grok',
    title: t('provider.grok.title'),
    metricsTitle: t('section.metrics.extra'),
    clientName: t('provider.grok.clientName'),
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-grok',
    ariaLabel: t('provider.grok.ariaLabel'),
  },
  ollama: {
    id: 'ollama',
    title: t('provider.ollama.title'),
    metricsTitle: t('section.metrics.extra'),
    clientName: 'Ollama',
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-ollama',
    ariaLabel: t('provider.ollama.ariaLabel'),
    networkErrorNote: t('provider.ollama.networkErrorNote'),
  },
  opencode: {
    id: 'opencode',
    title: t('provider.opencode.title'),
    metricsTitle: t('section.metrics.extra'),
    clientName: 'OpenCode',
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-opencode',
    ariaLabel: t('provider.opencode.ariaLabel'),
  },
  codex: {
    id: 'codex',
    title: t('provider.codex.title'),
    metricsTitle: t('section.metrics.extra'),
    clientName: 'Codex',
    refreshHint: t('provider.refreshHint'),
    sectionId: 'usage-codex',
    ariaLabel: t('provider.codex.ariaLabel'),
  },
}

export interface UsageViewOptions {
  now: Date
  /** 수집 시각. Codex의 `reset_after_seconds` 계산에 쓴다. */
  fetchedAt?: string | null
}

/** 제공자별 정규화기 선택. ui와 app은 이 함수만 호출한다. */
export function buildProviderUsageView(provider: UsageProvider, raw: unknown, options: UsageViewOptions): UsageReport {
  if (provider === 'antigravity') return buildAntigravityUsageView(raw, options)
  if (provider === 'grok') return buildGrokUsageView(raw, options)
  if (provider === 'ollama') return buildOllamaUsageView(raw, options)
  if (provider === 'opencode') return buildOpencodeUsageView(raw, options)
  if (provider === 'codex') return buildCodexUsageView(raw, options)
  return buildUsageView(raw, { now: options.now })
}
