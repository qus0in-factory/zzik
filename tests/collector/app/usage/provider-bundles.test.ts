import { describe, expect, it } from 'vitest'
import {
  buildProviderBundles,
  resolveSendAccountId,
} from '../../../../collector/app/usage/provider-bundles.mjs'
import { USAGE_REDACTION_PATHS } from '../../../../collector/domain/usage/providers.mjs'

/** 조립 루트(main.mjs)의 배선을 단위 테스트로 검증한다(스택 부록 A4와 같은 취지).
 * 이전 검수에서 buildProviders가 runOptions를 넘기지 않는 문제는 포트에 옵션을
 * 직접 주입하는 테스트로는 잡을 수 없었으므로, 배선 자체를 테스트한다.
 */

const REDACTION_FOR = (id: string): readonly string[] =>
  (USAGE_REDACTION_PATHS as Record<string, readonly string[]>)[id] ?? []

describe('Given the provider bundle wiring (ADR 0.3 D3·D5 배선)', () => {
  it('When wiring both providers then every bundle carries its provider redactionPaths', () => {
    const bundles = buildProviderBundles({
      providerIds: ['claude', 'codex'],
      flags: { provider: null, credentialsPath: null, codexAccountHeader: false },
      envSendAccountId: false,
      buildPorts: (id: string) => ({ provider: id }) as never,
    })
    expect(bundles.map((b) => b.id)).toEqual(['claude', 'codex'])
    expect(bundles[0].runOptions).toEqual({ redactionPaths: REDACTION_FOR('claude') })
    expect(bundles[1].runOptions).toEqual({ redactionPaths: REDACTION_FOR('codex') })
    expect(bundles[1].ports).toEqual({ provider: 'codex' })
    expect(bundles[1].runOptions.sendAccountId).toBeUndefined()
  })

  it('When --provider selects a single provider then only that bundle is built', () => {
    const bundles = buildProviderBundles({
      providerIds: ['claude', 'codex'],
      flags: { provider: 'codex', credentialsPath: '/tmp/auth.json', codexAccountHeader: false },
      envSendAccountId: false,
      buildPorts: (id: string) => ({ provider: id }) as never,
    })
    expect(bundles.map((b) => b.id)).toEqual(['codex'])
  })

  it('When sendAccountId is on then only codex carries sendAccountId (claude는 절대 아니다)', () => {
    const bundles = buildProviderBundles({
      providerIds: ['claude', 'codex'],
      flags: { provider: null, credentialsPath: null, codexAccountHeader: false },
      envSendAccountId: true,
      buildPorts: (id: string) => ({ provider: id }) as never,
    })
    expect(bundles[0].runOptions).toEqual({ redactionPaths: REDACTION_FOR('claude') }) // claude에 sendAccountId 없음
    expect(bundles[1].runOptions).toEqual({ redactionPaths: REDACTION_FOR('codex'), sendAccountId: true })
  })

  it('When the account header flag is raised on a codex-only run then codex sends the account id', () => {
    const bundles = buildProviderBundles({
      providerIds: ['claude', 'codex'],
      flags: { provider: 'codex', credentialsPath: null, codexAccountHeader: true },
      envSendAccountId: false,
      buildPorts: (id: string) => ({ provider: id }) as never,
    })
    expect(bundles[0].runOptions).toEqual({ redactionPaths: REDACTION_FOR('codex'), sendAccountId: true })
  })

  it('When redactionPaths lack the provider then an empty list is wired instead of undefined', () => {
    const bundles = buildProviderBundles({
      providerIds: ['claude'],
      flags: { provider: null, credentialsPath: null, codexAccountHeader: false },
      envSendAccountId: false,
      buildPorts: (id: string) => ({ provider: id }) as never,
      redactionPaths: {},
    })
    expect(bundles[0].runOptions).toEqual({ redactionPaths: [] })
  })
})

describe('Given the sendAccountId resolution', () => {
  it('When env ZZIK_CODEX_SEND_ACCOUNT_ID is 1 then it is on regardless of the flag', () => {
    expect(resolveSendAccountId({ envValue: true, codexAccountHeader: false })).toBe(true)
    expect(resolveSendAccountId({ envValue: true, codexAccountHeader: true })).toBe(true)
  })

  it('When the env is off then only the --codex-account-header flag decides', () => {
    expect(resolveSendAccountId({ envValue: false, codexAccountHeader: true })).toBe(true)
    expect(resolveSendAccountId({ envValue: false, codexAccountHeader: false })).toBe(false)
    expect(resolveSendAccountId({ envValue: false, codexAccountHeader: true })).toBe(true) // 정의되지 않은 env도 꺼짐(투명 대체 제거)
  })
})
