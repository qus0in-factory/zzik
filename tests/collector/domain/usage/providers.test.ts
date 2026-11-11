import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { USAGE_PROVIDERS, USAGE_KV_KEYS, USAGE_COLLECTOR_VERSION } from '../../../../shared/usage-contract'

const BASE = fileURLToPath(new URL('../../../../', import.meta.url))
const contractSource = readFileSync(join(BASE, 'shared', 'usage-contract.ts'), 'utf8')
const providersSource = readFileSync(join(BASE, 'collector', 'domain', 'usage', 'providers.mjs'), 'utf8')

/** 수집기는 .mjs라 shared를 런타임에 import할 수 없다 — 두 곳의 일치를 이 테스트가 확인한다(ADR 0.3 D5). */
describe('Given the provider contract', () => {
  it('When the collector provider list is compared with shared then they are the same', () => {
    // shared의 정의를 소스 텍스트에서 읽어 런타임 상수와 대조한다.
    expect(contractSource).toContain("['claude', 'codex'] as const")
    expect(providersSource).toContain("['claude', 'codex']")
    expect([...USAGE_PROVIDERS]).toEqual(['claude', 'codex'])
  })

  it('When the KV keys are compared then each provider maps to its own key', () => {
    expect(contractSource).toContain("claude: 'usage:claude'")
    expect(contractSource).toContain("codex: 'usage:codex'")
    expect(USAGE_KV_KEYS).toEqual({ claude: 'usage:claude', codex: 'usage:codex' })
  })

  it('When the collector version changes then the contract source matches the runtime value', () => {
    expect(contractSource).toContain(`USAGE_COLLECTOR_VERSION = '${USAGE_COLLECTOR_VERSION}'`)
    expect(USAGE_COLLECTOR_VERSION).toBe('0.3.0')
  })

  it('When the old USAGE_KEY is gone then no provider-bound key constant remains', () => {
    expect(contractSource).not.toContain('export const USAGE_KEY')
  })
})
