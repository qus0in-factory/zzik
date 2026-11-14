import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_GROK_AUTH_PATH, readGrokBuildCredentials } from '../../../../collector/infra/usage/grok-build-credentials-file.mjs'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zzik-grok-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const entry = (key = 'synthetic-access', expires_at: unknown = '2026-11-15T12:30:45.123456Z') => ({
  key, expires_at, refresh_token: 'synthetic-refresh', email: 'synthetic@example.invalid',
  user_id: 'synthetic-user', principal_id: 'synthetic-principal', team_id: 'synthetic-team',
})
const account = 'https://auth.x.ai::synthetic-account'
async function read(json: unknown) {
  const path = join(dir, 'auth.json')
  writeFileSync(path, JSON.stringify(json))
  return readGrokBuildCredentials(path)
}

describe('Given Grok Build auth.json credentials', () => {
  it('When reading a login Then exposes only access token and millisecond expiry', async () => {
    expect(await read({ [account]: entry() })).toEqual({
      source: 'file', token: 'synthetic-access', expiresAt: Date.parse('2026-11-15T12:30:45.123Z'),
    })
  })
  it('When the default path is used Then reads the Grok Build home', () => {
    expect(DEFAULT_GROK_AUTH_PATH).toBe(join(homedir(), '.grok', 'auth.json'))
  })
  it('When the file is missing or malformed Then returns null', async () => {
    expect(await readGrokBuildCredentials(join(dir, 'missing.json'))).toBeNull()
    const path = join(dir, 'auth.json')
    writeFileSync(path, '{invalid')
    expect(await readGrokBuildCredentials(path)).toBeNull()
  })
  it.each([null, [], {}, 'text', { [account]: null }, { [account]: {} },
    { [account]: { key: '' } }, { [account]: { key: 123 } },
    { 'https://other.invalid::account': entry() },
  ])('When no supported login with a nonempty key exists Then returns null (%j)', async json => {
    expect(await read(json)).toBeNull()
  })
  it.each([undefined, null, 'invalid', 123])('When expiry is unknown (%s) Then preserves the token with null expiry', async expiry => {
    expect(await read({ [account]: { ...entry(), expires_at: expiry } })).toEqual({
      source: 'file', token: 'synthetic-access', expiresAt: null,
    })
  })
  it('When several accounts exist Then selects the latest known expiry regardless of file order', async () => {
    const accounts = {
      [account]: entry('unknown', null),
      'https://auth.x.ai::older': entry('older', '2026-11-14T00:00:00Z'),
      'https://auth.x.ai::latest': entry('latest', '2026-11-16T00:00:00Z'),
      'https://auth.x.ai::invalid': { expires_at: '2026-11-20T00:00:00Z' },
    }
    expect((await read(accounts))?.token).toBe('latest')
    expect((await read(Object.fromEntries(Object.entries(accounts).reverse())))?.token).toBe('latest')
  })
  it('When expiries tie or are all unknown Then chooses the first valid account', async () => {
    for (const expiry of [null, '2026-11-15T00:00:00Z']) {
      expect((await read({ [account]: entry('first', expiry), 'https://auth.x.ai::second': entry('second', expiry) }))?.token).toBe('first')
    }
  })
})
