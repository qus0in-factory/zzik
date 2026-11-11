import { USAGE_PROVIDER_META, USAGE_PROVIDERS } from '@domain/usage/providers'
import type { UsageProvider, UsageProviderMeta } from '@domain/usage/providers'

/**
 * 제공자 메타데이터를 ui에 전달하는 app 계층 창구.
 * 레이어 규칙상 ui는 domain의 값을 직접 import하지 않는다(타입만 허용).
 * ui는 이 모듈이 돌려주는 표시용 데이터만 쓴다.
 */

/** 화면에 고정 순서로 놓을 제공자 목록(ADR 0.3 D8). */
export function usageProviderIds(): readonly UsageProvider[] {
  return USAGE_PROVIDERS
}

/** 섹션 제목·aria-label·갱신 안내 등 표시용 메타. */
export function providerMetaFor(provider: UsageProvider): UsageProviderMeta {
  return USAGE_PROVIDER_META[provider]
}
