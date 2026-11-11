import type { UsageGateway, UsageGatewayResult } from '@domain/usage/gateway'
import type { RawUsage } from '@domain/usage/types'
import normalRaw from '../../../tests/fixtures/claude-usage.normal.json'
import limitedRaw from '../../../tests/fixtures/claude-usage.limited.json'
import unknownKeysRaw from '../../../tests/fixtures/claude-usage.unknown-keys.json'
import warnRaw from '../../../tests/fixtures/claude-usage.warn.json'

/**
 * 개발·테스트용 목 게이트웨이. `?fixture=<name>` 쿼리로 시나리오를 전환한다.
 * 0.2에서 `http-usage-gateway`가 이 자리를 대체할 때 이 파일은 삭제한다.
 */

export type FixtureName = 'normal' | 'warn' | 'limited' | 'unknown-keys' | 'error' | 'loading'

export const FIXTURE_NAMES: readonly FixtureName[] = ['normal', 'warn', 'limited', 'unknown-keys', 'error', 'loading']

const FIXTURE_USAGE: Record<Exclude<FixtureName, 'error' | 'loading'>, RawUsage> = {
  normal: normalRaw as RawUsage,
  warn: warnRaw as RawUsage,
  limited: limitedRaw as RawUsage,
  ['unknown-keys']: unknownKeysRaw as RawUsage,
}

export function parseFixtureUsageName(search: string | null | undefined): FixtureName {
  const match = search ? /(?:^|[?&])fixture=([^&]*)/.exec(search) : null
  const value = match?.[1]
  if (value !== undefined && value.length > 0 && (FIXTURE_NAMES as readonly string[]).includes(value)) {
    return value as FixtureName
  }
  return 'normal'
}

export function createFixtureUsageGateway(options: { getSearch?: () => string | undefined } = {}): UsageGateway {
  const getSearch =
    options.getSearch ??
    ((): string | undefined => {
      if (typeof window === 'undefined') return undefined
      return window.location.search
    })

  return {
    async fetchUsage(): Promise<UsageGatewayResult> {
      const name = parseFixtureUsageName(getSearch() ?? null)
      if (name === 'error') {
        return { ok: false, reason: 'api_error', message: '목 게이트웨이(error 시나리오): API 오류를 흉내 냅니다' }
      }
      if (name === 'loading') {
        // 의도로 끝나지 않는 요청: 로딩 상태를 확인한다.
        return new Promise<UsageGatewayResult>(() => {})
      }
      return { ok: true, usage: FIXTURE_USAGE[name] }
    },
  }
}
