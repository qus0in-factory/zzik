/** 제공자 등록부(ADR 0.3 D8). 순수 데이터와 뷰 생성 함수 참조만 둔다. */

import { buildUsageView } from './view'
import { buildCodexUsageView } from './codex-view'
import type { UsageGatewaySuccess } from './gateway'
import type { UsageReport } from './types'

export interface UsageProviderRegistration {
  /** 화면 제목(예: 요약 칩 `Claude · 정상`) */
  title: string
  /** 사용 창 다음의 추가 섹션 제목 */
  extraSectionTitle: string
  /** 갱신 안내 문구 */
  refreshHint: string
  /** 게이트웨이 성공 데이터 → 뷰 모델. now는 상대 시각 계산 기준, fetchedAt은 reset_after 기준(D8) */
  buildView: (data: UsageGatewaySuccess, options: { now: Date; fetchedAt?: string | null }) => UsageReport
}

export const USAGE_PROVIDER_REGISTRY: Record<string, UsageProviderRegistration> = {
  claude: {
    title: 'Claude',
    extraSectionTitle: '모델·기능별 한도',
    refreshHint: '이 Mac에서 Claude Code를 실행하면 갱신된다',
    buildView: (data, options) => buildUsageView(data.usage ?? {}, { now: options.now }),
  },
  codex: {
    title: 'ChatGPT (Codex)',
    extraSectionTitle: '추가 한도',
    refreshHint: '이 Mac에서 Codex를 실행하면 갱신된다',
    buildView: (data, options) => buildCodexUsageView(data.usage, { now: options.now, fetchedAt: options.fetchedAt ?? null }),
  },
}

export function providerRegistration(provider: string): UsageProviderRegistration | null {
  return USAGE_PROVIDER_REGISTRY[provider] ?? null
}
