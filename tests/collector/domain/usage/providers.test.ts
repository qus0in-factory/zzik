import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { USAGE_PROVIDERS, USAGE_KV_KEYS, USAGE_COLLECTOR_VERSION } from '../../../../shared/usage-contract'
import { parseProvidersEnv } from '../../../../collector/domain/usage/providers.mjs'

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

describe('Given ZZIK_PROVIDERS parsing (v2 D3)', () => {
  it('When the env is missing then the default claude,codex applies', () => {
    expect(parseProvidersEnv(undefined).providers).toEqual(['claude', 'codex'])
  })
  it('When values have spaces, upper case and duplicates then they are trimmed, lowered and deduped', () => {
    const parsed = parseProvidersEnv(' Codex, claude , CODEX ')
    expect(parsed.providers).toEqual(['codex', 'claude'])
    expect(parsed.warnings).toEqual([])
  })
  it('When a value is unknown then it is collected as a warning and dropped', () => {
    const parsed = parseProvidersEnv('claude, bogusbogo, codex, anthropic2')
    expect(parsed.providers).toEqual(['claude', 'codex'])
    expect(parsed.warnings).toEqual(['bogusbogo', 'anthropic2'])
  })
  it('When the result is empty then the caller must exit with code 78 (조립 루트가 판단)', () => {
    expect(parseProvidersEnv('bogus').providers).toEqual([])
    expect(parseProvidersEnv('  ').providers).toEqual([])
  })
})
