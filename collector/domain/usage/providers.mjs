/**
 * 제공자 id와 KV 키(ADR 0.3 D5). shared/usage-contract.ts의 값과 같아야 하며,
 * 하나의 테스트가 두 곳의 일치를 확인한다(.mjs는 shared를 런타임에 import할 수 없다).
 */

export const USAGE_PROVIDERS = ['claude', 'codex']

export const USAGE_KV_KEYS = {
  claude: 'usage:claude',
  codex: 'usage:codex',
}

export const USAGE_COLLECTOR_VERSION = '0.3.0'
