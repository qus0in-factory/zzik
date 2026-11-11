/**
 * 제공자 번들 배선(ADR 0.3 D3·D5, 스택 부록 A4 배선 검증).
 * 조립 루트(main.mjs)의 buildProviders는 이 함수를 사용한다. 배선(가림 목록·계정 헤더
 * 옵션·제공자 필터·포트 생성)을 순수 함수로 분리해 단위 테스트로 검증한다 — 옵션을
 * run-once에 직접 주입하는 테스트로는 배선 누락을 잡을 수 없기 때문이다.
 */

import { USAGE_REDACTION_PATHS } from '../../domain/usage/providers.mjs'

/**
 * @typedef {import('../../domain/usage/ports.mjs').CollectorPorts} CollectorPorts
 */

/**
 * 계정 헤더 전송 여부 결정(스택 부록 15번: env ZZIK_CODEX_SEND_ACCOUNT_ID='1' 또는
 * --codex-account-header 플래그).
 * @param {{ envValue: boolean, codexAccountHeader: boolean }} input
 * @returns {boolean}
 */
export function resolveSendAccountId({ envValue, codexAccountHeader }) {
  if (envValue === true) return true
  return codexAccountHeader === true
}

/**
 * @param {{
 *   providerIds: readonly string[],
 *   flags: { provider: string|null, credentialsPath: string|null, codexAccountHeader: boolean },
 *   envSendAccountId?: boolean,
 *   redactionPaths?: Record<string, readonly string[]>,
 *   buildPorts: (providerId: string) => CollectorPorts,
 * }} input
 * @returns {Array<{ id: string, ports: CollectorPorts, runOptions: { redactionPaths: readonly string[], sendAccountId?: boolean } }>}
 */
export function buildProviderBundles({ providerIds, flags, envSendAccountId = false, redactionPaths = USAGE_REDACTION_PATHS, buildPorts }) {
  const selected =
    flags.provider !== null && flags.provider !== undefined ? providerIds.filter((id) => id === flags.provider) : providerIds
  const sendAccountId = resolveSendAccountId({ envValue: envSendAccountId, codexAccountHeader: flags.codexAccountHeader })
  return selected.map((id) => ({
    id,
    ports: buildPorts(id),
    runOptions: {
      redactionPaths: redactionPaths[id] ?? [],
      ...(id === 'codex' && sendAccountId ? { sendAccountId: true } : {}),
    },
  }))
}
