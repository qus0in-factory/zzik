import type { UsageGateway, UsageGatewayResult } from '@domain/usage/gateway'
import { parseFixtureUsageName } from '@domain/usage/fixture-name'
import type { RawUsage } from '@domain/usage/types'
import { rebaseUsageResetsAt } from '@domain/usage/calibration'
import normalRaw from '../../../tests/fixtures/claude-usage.normal.json'
import limitedRaw from '../../../tests/fixtures/claude-usage.limited.json'
import unknownKeysRaw from '../../../tests/fixtures/claude-usage.unknown-keys.json'
import warnRaw from '../../../tests/fixtures/claude-usage.warn.json'

/**
 * 개발·테스트용 목 게이트웨이. `?fixture=<name>` 쿼리 또는 주입된 선택 getter(스택 부록 A5의
 * Zustand 상태)로 시나리오를 전환한다. 프로덕션 번들에는 DEV 조립 분기로만 들어간다.
 */

export type FixtureName = 'normal' | 'warn' | 'limited' | 'unknown-keys' | 'error' | 'loading'

/** 이름 해석은 domain의 순수 함수로(스토어 초기값도 같은 규칙을 쓴다). */
export const FIXTURE_NAMES = ['normal', 'warn', 'limited', 'unknown-keys', 'error', 'loading'] as const
export { parseFixtureUsageName }

/** fixture 파일들이 작성된 기준 시각. resets_at 보정의 원점이다. */
export const FIXTURE_ANCHOR_ISO = '2026-11-11T12:00:00.000Z'

const FIXTURE_USAGE: Record<Exclude<FixtureName, 'error' | 'loading'>, RawUsage> = {
  normal: normalRaw as RawUsage,
  warn: warnRaw as RawUsage,
  limited: limitedRaw as RawUsage,
  ['unknown-keys']: unknownKeysRaw as RawUsage,
}

export interface FixtureUsageGatewayOptions {
  /** 현재 쿼리 문자열. 픽스처 선택 getter가 없을 때의 기본 근원이다. */
  getSearch?: () => string | undefined
  /** 픽스처 선택(Zustand 상태). 있으면 검색 문자열보다 우선한다(스택 부록 A5). */
  getFixtureName?: () => string | undefined
  /** 현재 시각(ISO). 생략하면 실제 시각을 쓰고, 주입하면 테스트가 고정한다. */
  now?: () => string
}

export function createFixtureUsageGateway(options: FixtureUsageGatewayOptions = {}): UsageGateway {
  const getSearch =
    options.getSearch ??
    ((): string | undefined => {
      if (typeof window === 'undefined') return undefined
      return window.location.search
    })
  const now = options.now ?? ((): string => new Date().toISOString())

  return {
    async fetchUsage(): Promise<UsageGatewayResult> {
      const chosen = options.getFixtureName?.()
      const name = chosen !== undefined && chosen.length > 0
        ? parseFixtureUsageName(`?fixture=${chosen}`)
        : parseFixtureUsageName(getSearch() ?? null)
      if (name === 'error') {
        return { ok: false, reason: 'api_error', message: '목 게이트웨이(error 시나리오): API 오류를 흉내 냅니다' }
      }
      if (name === 'loading') {
        // 의도로 끝나지 않는 요청: 로딩 상태를 확인한다.
        return new Promise<UsageGatewayResult>(() => {})
      }
      // 작성 시점 고정값을 지금 기준으로 옮겨, 목 화면이 "리셋 시각 경과"로 굳지 않게 한다.
      const usage = rebaseUsageResetsAt(FIXTURE_USAGE[name], new Date(FIXTURE_ANCHOR_ISO), new Date(now()))
      return { ok: true, usage, collection: null, rawText: null }
    },
  }
}
