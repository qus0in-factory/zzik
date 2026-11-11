import { buildCodexUsageView } from './codex-view'
import type { UsageReport } from './types'
import { buildUsageView } from './view'

/**
 * 제공자 등록부 (ADR 0.3 D8).
 * 프론트가 아는 제공자 목록, 화면 메타데이터, 제공자별 뷰 생성기를 한 곳에 둔다.
 * 화면 컴포넌트는 제공자별 분기를 갖지 않고 이 등록부만 본다.
 */

export const USAGE_PROVIDERS = ['claude', 'codex'] as const

export type UsageProvider = (typeof USAGE_PROVIDERS)[number]

export function isUsageProvider(value: unknown): value is UsageProvider {
  return typeof value === 'string' && (USAGE_PROVIDERS as readonly string[]).includes(value)
}

export interface UsageProviderMeta {
  id: UsageProvider
  title: string
  metricsTitle: string
  refreshHint: string
  sectionId: string
  ariaLabel: string
}

export const USAGE_PROVIDER_META: Record<UsageProvider, UsageProviderMeta> = {
  claude: {
    id: 'claude',
    title: 'Claude',
    metricsTitle: '모델·기능별 한도',
    refreshHint: '이 Mac에서 Claude Code를 실행하면 갱신된다',
    sectionId: 'usage-claude',
    ariaLabel: 'Claude 사용량',
  },
  codex: {
    id: 'codex',
    title: 'ChatGPT (Codex)',
    metricsTitle: '추가 한도',
    refreshHint: '이 Mac에서 Codex를 실행하면 갱신된다',
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
  if (provider === 'codex') return buildCodexUsageView(raw, options)
  return buildUsageView(raw, { now: options.now })
}
