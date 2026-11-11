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

/** 제공자 정의의 가림 목록(ADR 0.3 D5). codex는 G2에서 정한다(기본 빈 목록), claude는 비어 있다. */
export const USAGE_REDACTION_PATHS = {
  claude: [],
  codex: [],
}

/**
 * ZZIK_PROVIDERS 해석(ADR 0.3 v2 D3): 쉼표 분리, 공백 제거, 소문자, 중복 제거,
 * 목록에 없는 값은 경고로 모은다. 결과가 비면 조립 루트가 오류로 끝낸다(코드 78).
 *
 * @param {string|undefined|null} value env 원문
 * @returns {{ providers: string[], warnings: string[] }}
 */
export function parseProvidersEnv(value) {
  const raw = (value ?? 'claude,codex').split(',').map((item) => item.trim().toLowerCase())
  /** @type {string[]} */
  const providers = []
  /** @type {string[]} */
  const warnings = []
  const seen = new Set()
  for (const item of raw) {
    if (item === '') continue
    if (!USAGE_PROVIDERS.includes(item) && !seen.has(item)) warnings.push(item)
    if (!USAGE_PROVIDERS.includes(item) || seen.has(item)) continue
    seen.add(item)
    providers.push(item)
  }
  return { providers, warnings }
}
