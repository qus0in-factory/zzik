import type { TrendGateway } from '@domain/trend/gateway'
import { TREND_FIXTURE_SECTIONS } from './fixture-trend-data'

/** DEV 전용 `?fixture=normal` 트렌드 게이트웨이. 운영 번들에는 동적 import 분기로만 들어간다. */
export function createFixtureTrendGateway(): TrendGateway {
  return {
    async fetchSection(section) {
      const value = TREND_FIXTURE_SECTIONS[section]
      if (value === undefined) return { ok: false, reason: 'not_ready', message: 'not_ready' }
      return { ok: true, value }
    },
  }
}
