import { rebaseIsoFields } from '@domain/usage/rebase-iso-fields'
import agyNormal from '../../../tests/fixtures/antigravity-usage.normal.json'
import agyLimited from '../../../tests/fixtures/antigravity-usage.limited.json'
import agyUnknown from '../../../tests/fixtures/antigravity-usage.unknown-keys.json'
import type { UsageGateway, UsageGatewayResult } from '@domain/usage/gateway'
import type { UsageCollectionMeta } from '../../../shared/usage-contract'
import { parseFixtureUsageName } from '@domain/usage/fixture-name'
import type { UsageProvider } from '@domain/usage/providers'
import { rebaseUsageResetsAt } from '@domain/usage/calibration'
import claudeNormalRaw from '../../../tests/fixtures/claude-usage.normal.json'
import claudeLimitedRaw from '../../../tests/fixtures/claude-usage.limited.json'
import claudeUnknownKeysRaw from '../../../tests/fixtures/claude-usage.unknown-keys.json'
import claudeWarnRaw from '../../../tests/fixtures/claude-usage.warn.json'
import grokNormalRaw from '../../../tests/fixtures/grok-usage.normal.json'
import grokLimitedRaw from '../../../tests/fixtures/grok-usage.limited.json'
import grokUnknownKeysRaw from '../../../tests/fixtures/grok-usage.unknown-keys.json'
import opencodeNormalRaw from '../../../tests/fixtures/opencode-usage.normal.json'
import opencodeLimitedRaw from '../../../tests/fixtures/opencode-usage.limited.json'
import opencodeUnknownKeysRaw from '../../../tests/fixtures/opencode-usage.unknown-keys.json'
import ollamaNormalRaw from '../../../tests/fixtures/ollama-usage.normal.json'
import ollamaLimitedRaw from '../../../tests/fixtures/ollama-usage.limited.json'
import ollamaUnknownKeysRaw from '../../../tests/fixtures/ollama-usage.unknown-keys.json'
import codexNormalRaw from '../../../tests/fixtures/codex-usage.normal.json'
import codexLimitedRaw from '../../../tests/fixtures/codex-usage.limited.json'
import codexUnknownKeysRaw from '../../../tests/fixtures/codex-usage.unknown-keys.json'

/**
 * 개발·테스트용 목 게이트웨이(스택 부록 A5, ADR 0.3 D8). `?fixture=<name>` 쿼리 또는
 * 주입된 선택 getter(Zustand 상태)로 시나리오를 전환하고, 제공자별 fixture를 돌려준다.
 * 프로덕션 번들에는 DEV 조립 분기로만 들어간다.
 */

export type FixtureName = 'normal' | 'warn' | 'limited' | 'unknown-keys' | 'auth_rejected' | 'error' | 'loading'

/** DEV 시나리오에서 날짜를 지금 기준으로 옮길 제공자별 시각 키(Codex는 Unix 초 절대값이라 제외). */
const REBASE_KEYS: Partial<Record<UsageProvider, readonly string[]>> = {
  antigravity: ['resetTime'],
  grok: ['start', 'end', 'billingPeriodStart', 'billingPeriodEnd'],
  ollama: ['from', 'until'],
  opencode: ['resetsAt'],
}

/** 이름 해석은 domain의 순수 함수로(스토어 초기값도 같은 규칙을 쓴다). */
export const FIXTURE_NAMES = ['normal', 'warn', 'limited', 'unknown-keys', 'auth_rejected', 'error', 'loading'] as const
export { parseFixtureUsageName }

/** fixture 파일들이 작성된 기준 시각. Claude `resets_at` 보정의 원점이다. */
export const FIXTURE_ANCHOR_ISO = '2026-11-11T12:00:00.000Z'

type ScenarioName = Exclude<FixtureName, 'error' | 'loading' | 'auth_rejected'>

const CLAUDE_FIXTURES: Record<ScenarioName, Record<string, unknown>> = {
  normal: claudeNormalRaw as Record<string, unknown>,
  warn: claudeWarnRaw as Record<string, unknown>,
  limited: claudeLimitedRaw as Record<string, unknown>,
  ['unknown-keys']: claudeUnknownKeysRaw as Record<string, unknown>,
}

/**
 * Codex는 `reset_at`이 Unix 초(절대값)라 Claude처럼 상대 보정을 하지 않는다.
 * 모든 시나리오에 값이 있는 것만 두고, 없는 시나리오는 normal로 대체한다.
 */
const CODEX_FIXTURES: Partial<Record<ScenarioName, Record<string, unknown>>> = {
  normal: codexNormalRaw as Record<string, unknown>,
  limited: codexLimitedRaw as Record<string, unknown>,
  ['unknown-keys']: codexUnknownKeysRaw as Record<string, unknown>,
}

const FIXTURES: Record<UsageProvider, Record<ScenarioName, Record<string, unknown>>> = {
  grok: { normal: grokNormalRaw, warn: grokNormalRaw, limited: grokLimitedRaw, ['unknown-keys']: grokUnknownKeysRaw },
  ollama: { normal: ollamaNormalRaw, warn: ollamaNormalRaw, limited: ollamaLimitedRaw, ['unknown-keys']: ollamaUnknownKeysRaw },
  opencode: { normal: opencodeNormalRaw, warn: opencodeNormalRaw, limited: opencodeLimitedRaw, ['unknown-keys']: opencodeUnknownKeysRaw },
  antigravity: { normal: agyNormal, warn: agyLimited, limited: agyLimited, ['unknown-keys']: agyUnknown },
  claude: CLAUDE_FIXTURES,
  codex: {
    normal: CODEX_FIXTURES.normal ?? {},
    warn: CODEX_FIXTURES.normal ?? {},
    limited: CODEX_FIXTURES.limited ?? {},
    ['unknown-keys']: CODEX_FIXTURES['unknown-keys'] ?? {},
  },
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
    async fetchUsage(provider: UsageProvider): Promise<UsageGatewayResult> {
      const chosen = options.getFixtureName?.()
      const name =
        chosen !== undefined && chosen.length > 0
          ? parseFixtureUsageName(`?fixture=${chosen}`)
          : parseFixtureUsageName(getSearch() ?? null)
      if (name === 'error') {
        return { ok: false, reason: 'api_error', message: '목 게이트웨이(error 시나리오): API 오류를 흉내 냅니다' }
      }
      if (name === 'loading') {
        // 의도로 끝나지 않는 요청: 로딩 상태를 확인한다.
        return new Promise<UsageGatewayResult>(() => {})
      }
      if (name === 'auth_rejected') {
        // 서버가 유효한 토큰을 거부한 상태(v2 H2). 값은 정상 fixture를 그대로 쓰고 봉투만 거부로 둔다.
        const at = now()
        const collection: UsageCollectionMeta = {
          schema: 1,
          provider,
          status: 'auth_rejected',
          called: true,
          runAt: at,
          fetchedAt: at,
          httpStatus: 401,
          retryAt: null,
          tokenExpiresAt: null,
          kvTokenExpiresAt: null,
          intervalSec: 300,
          collectorVersion: '0.6.0',
          rawOmitted: null,
        }
        return { ok: true, usage: FIXTURES[provider].normal, collection, rawText: null }
      }
      const fixture = FIXTURES[provider][name]
      // Claude는 작성 시점 고정값을 지금 기준으로 옮겨 "리셋 시각 경과"로 굳지 않게 한다.
      const rebaseKeys = REBASE_KEYS[provider]
      const usage =
        rebaseKeys !== undefined
          ? rebaseIsoFields(fixture, rebaseKeys, new Date(FIXTURE_ANCHOR_ISO), new Date(now()))
          : provider === 'claude'
          ? rebaseUsageResetsAt(fixture as never, new Date(FIXTURE_ANCHOR_ISO), new Date(now()))
          : fixture
      return { ok: true, usage, collection: null, rawText: null }
    },
  }
}
