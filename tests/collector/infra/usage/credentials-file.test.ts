import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readCredentialsFile } from '../../../../collector/infra/usage/credentials-file.mjs'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zzik-cred-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Given the Claude credentials file reader', () => {
  it('When the file holds a Claude Code OAuth JSON then it yields the token and expiry', async () => {
    const path = join(dir, 'credentials.json')
    writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'file-token', expiresAt: 1799999999000 } }))
    const read = await readCredentialsFile(path)
    expect(read).toEqual({ source: 'file', token: 'file-token', expiresAt: 1799999999000 })
  })

  it('When expiresAt is an ISO string then it converts to epoch millis', async () => {
    const path = join(dir, 'credentials.json')
    writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'file-token', expiresAt: '2027-02-09T00:00:00.000Z' } }))
    const read = await readCredentialsFile(path)
    expect(read?.expiresAt).toBe(Date.parse('2027-02-09T00:00:00.000Z'))
  })

  it('When there is no expiresAt field then it is null (401로 판정 대상)', async () => {
    const path = join(dir, 'credentials.json')
    writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: 'file-token' } }))
    const read = await readCredentialsFile(path)
    expect(read?.expiresAt).toBeNull()
  })

  it('When the file is missing, empty or malformed then there is no credential', async () => {
    expect(await readCredentialsFile(join(dir, 'missing.json'))).toBeNull()
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{oops')
    expect(await readCredentialsFile(broken)).toBeNull()
    const empty = join(dir, 'empty.json')
    writeFileSync(empty, '')
    expect(await readCredentialsFile(empty)).toBeNull()
    const noToken = join(dir, 'no-token.json')
    writeFileSync(noToken, JSON.stringify({ claudeAiOauth: { refreshToken: 'x' } }))
    expect(await readCredentialsFile(noToken)).toBeNull()
  })
})
