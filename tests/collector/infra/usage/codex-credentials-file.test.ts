import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCodexCredentials, DEFAULT_CODEX_AUTH_PATH } from '../../../../collector/infra/usage/codex-credentials-file.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zzik-codex-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const enc = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const makeJwt = (payload: object): string => `h.${enc(payload)}.s`

const VALID_AUTH = {
  auth_mode: 'chatgpt',
  tokens: {
    access_token: makeJwt({ exp: 1799999999 }),
    refresh_token: 'do-not-touch',
    id_token: 'do-not-touch',
    account_id: 'acct-123',
  },
}

describe('Given the Codex auth.json reader (ADR 0.3 D2)', () => {
  it('When the auth is a ChatGPT login then only token, expiry and accountId come out', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify(VALID_AUTH))
    const read = await readCodexCredentials(path, { sleep: async () => {} })
    expect(read).toEqual({
      source: 'codex',
      token: VALID_AUTH.tokens.access_token,
      expiresAt: 1799999999 * 1000,
      accountId: 'acct-123',
    })
  })

  it('When the JSON parse fails twice then there is no credential (200ms 재시도 후 포기)', async () => {
    const path = join(dir, 'auth.json')
    const sleeps: number[] = []
    writeFileSync(path, '{"oops') // Codex가 파일을 쓰는 중일 수 있다(D2)
    const read = await readCodexCredentials(path, {
      retryDelayMs: 200,
      sleep: async (ms: number) => { sleeps.push(ms) },
    })
    expect(read).toBeNull()
    expect(sleeps).toEqual([200])
  })

  it('When the JSON parse fails once and the file settles then the retry succeeds', async () => {
    const path = join(dir, 'auth.json')
    const real = JSON.stringify(VALID_AUTH)
    writeFileSync(path, '{"oops')
    const read = await readCodexCredentials(path, {
      retryDelayMs: 200,
      sleep: async () => { writeFileSync(path, real) }, // 재시도 직전에 Codex가 파일을 완성했다고 본다
    })
    expect(read?.token).toBe(VALID_AUTH.tokens.access_token)
  })

  it('When auth_mode is apikey then there is no credential (API 키로는 WHAM을 쓸 수 없다)', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-x' }))
    expect(await readCodexCredentials(path, { sleep: async () => {} })).toBeNull()
  })

  it('When the file is missing then there is no credential', async () => {
    expect(await readCodexCredentials(join(dir, 'missing.json'), { sleep: async () => {} })).toBeNull()
  })

  it('When tokens.access_token is missing then there is no credential', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify({ auth_mode: 'chatgpt', tokens: { refresh_token: 'r' } }))
    expect(await readCodexCredentials(path, { sleep: async () => {} })).toBeNull()
  })

  it('When the result is built then it never carries refresh_token or id_token or OPENAI_API_KEY', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify(VALID_AUTH))
    const read = await readCodexCredentials(path, { sleep: async () => {} })
    const serialized = JSON.stringify(read ?? {})
    expect(serialized).not.toContain('do-not-touch')
    expect(serialized).not.toContain('sk-x')
    expect(serialized).not.toContain('refresh_token')
    expect(serialized).not.toContain('id_token')
  })

  it('When the file permissions are wider than 0600 then only a warning is raised (L5)', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify(VALID_AUTH))
    chmodSync(path, 0o644)
    const warnings: string[] = []
    const read = await readCodexCredentials(path, { sleep: async () => {}, warn: (message: string) => warnings.push(message) })
    expect(read?.token).toBe(VALID_AUTH.tokens.access_token)
    expect(warnings.some((message) => message.includes('0600'))).toBe(true)
  })

  it('When the default path is referenced then it points at the codex home', () => {
    expect(DEFAULT_CODEX_AUTH_PATH).toMatch(/\.codex\/auth\.json$/)
  })
})
