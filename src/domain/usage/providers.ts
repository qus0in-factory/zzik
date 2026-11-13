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
    title: 'Antigravity',
    metricsTitle: '추가 한도',
    clientName: 'Antigravity',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-antigravity',
    ariaLabel: 'Antigravity 사용량',
  },
  claude: {
    id: 'claude',
    title: 'Claude',
    metricsTitle: '모델·기능별 한도',
    clientName: 'Claude Code',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-claude',
    ariaLabel: 'Claude 사용량',
  },
  grok: {
    id: 'grok',
    title: 'Grok',
    metricsTitle: '추가 한도',
    clientName: 'OpenCode(xAI 로그인)',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-grok',
    ariaLabel: 'Grok 사용량',
  },
  ollama: {
    id: 'ollama',
    title: 'Ollama',
    metricsTitle: '추가 한도',
    clientName: 'Ollama',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-ollama',
    ariaLabel: 'Ollama 사용량',
    networkErrorNote: '수집기 Mac의 Ollama 연결을 확인해 주세요. 다음 수집 주기에 자동으로 다시 시도합니다.',
  },
  opencode: {
    id: 'opencode',
    title: 'OpenCode',
    metricsTitle: '추가 한도',
    clientName: 'OpenCode',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-opencode',
    ariaLabel: 'OpenCode 사용량',
  },
  codex: {
    id: 'codex',
    title: 'ChatGPT (Codex)',
    metricsTitle: '추가 한도',
    clientName: 'Codex',
    refreshHint: '수집기가 15분마다 자동으로 갱신합니다.',
    sectionId: 'usage-codex',
    ariaLabel: 'ChatGPT 사용량',
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
