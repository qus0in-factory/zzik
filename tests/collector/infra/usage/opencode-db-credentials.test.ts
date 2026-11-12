import { chmodSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOpencodeDbCredentialReader, resetPermissionWarnings } from '../../../../collector/infra/usage/opencode-db-credentials.mjs'
import { createFakeOpencodeDb, type FakeOpencodeDb } from '../../../fakes/opencode-db'

let db: FakeOpencodeDb
const noSleep = async () => {}

beforeEach(() => {
  db = createFakeOpencodeDb()
  resetPermissionWarnings()
})
afterEach(() => db.cleanup())

describe('Given the OpenCode DB credential reader (설계 2절)', () => {
  it.each([
    ['xai', 'opencode-db:xai'],
    ['opencode', 'opencode-db:opencode'],
  ])('When integration %s has a row Then token and expiry come out and nothing else', async (integrationId, source) => {
    db.insert(integrationId, { access: 'fake-access', refresh: 'do-not-read', expires: 1791895909210, extra: 'x' }, 10)
    const read = await createOpencodeDbCredentialReader({ path: db.path, integrationId, sleep: noSleep })()
    expect(read).toEqual({ source, token: 'fake-access', expiresAt: 1791895909210, accountId: null })
    expect(JSON.stringify(read)).not.toContain('do-not-read')
  })

  it('When several rows exist Then the newest time_updated wins', async () => {
    db.insert('xai', { access: 'old' }, 1)
    db.insert('xai', { access: 'new' }, 9)
    const read = await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep })()
    expect(read?.token).toBe('new')
  })

  it('When the newest row has no access or broken JSON Then the next usable row is used', async () => {
    db.insert('xai', { access: 'usable' }, 1)
    db.insert('xai', { refresh: 'only' }, 5)
    db.insert('xai', '{not json', 9)
    const read = await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep })()
    expect(read?.token).toBe('usable')
  })

  it('When expires is missing or not a number Then expiresAt is null', async () => {
    db.insert('xai', { access: 'a', expires: '123' }, 1)
    const read = await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep })()
    expect(read?.expiresAt).toBeNull()
  })

  it('When there is no row for the integration Then null', async () => {
    db.insert('opencode', { access: 'a' }, 1)
    expect(await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep })()).toBeNull()
  })

  it('When the file is missing Then null after one retry', async () => {
    let slept = 0
    const read = await createOpencodeDbCredentialReader({ path: db.path + '.missing', integrationId: 'xai', sleep: async () => void (slept += 1) })()
    expect(read).toBeNull()
    expect(slept).toBe(1)
  })

  it('When opening fails once Then it retries and succeeds, always read-only', async () => {
    db.insert('xai', { access: 'a' }, 1)
    const options: unknown[] = []
    let calls = 0
    const { DatabaseSync } = await import('node:sqlite')
    const open = (path: string, opt: { readOnly: true }) => {
      options.push(opt)
      calls += 1
      if (calls === 1) throw new Error('SQLITE_BUSY')
      return new DatabaseSync(path, opt)
    }
    const read = await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', open, sleep: noSleep })()
    expect(read?.token).toBe('a')
    expect(options).toEqual([{ readOnly: true }, { readOnly: true }])
  })

  it('When the file mode is wider than 0600 Then the warning is emitted once per process', async () => {
    db.insert('xai', { access: 'a' }, 1)
    chmodSync(db.path, 0o644)
    const warnings: string[] = []
    const read = createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep, warn: (m) => warnings.push(m) })
    await read()
    await read()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('fake')
  })

  it('When the mode is 0600 Then no warning', async () => {
    db.insert('xai', { access: 'a' }, 1)
    chmodSync(db.path, 0o600)
    const warnings: string[] = []
    await createOpencodeDbCredentialReader({ path: db.path, integrationId: 'xai', sleep: noSleep, warn: (m) => warnings.push(m) })()
    expect(warnings).toEqual([])
  })
})
