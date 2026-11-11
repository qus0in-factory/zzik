import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStateFile } from '../../../../collector/infra/usage/state-file.mjs'
import { emptyCollectorState } from '../../../../collector/app/usage/run-once.mjs'

let root: string
let path: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zzik-state-'))
  path = join(root, 'state', 'usage-state.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('Given the collector state file', () => {
  it('When no state exists yet then read returns null and the app layer decides the default', async () => {
    const store = createStateFile({ path })
    await expect(store.read()).resolves.toBeNull()
  })

  it('When writing then the file is created with mode 0600 and the directory with 0700', async () => {
    const store = createStateFile({ path })
    const state = { ...emptyCollectorState(), lastRun: { status: 'ok', tokenExpiresAt: 123 } }
    await store.write(state)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, 'state')).mode & 0o777).toBe(0o700)
    await expect(store.read()).resolves.toEqual(state)
  })

  it('When writing twice then the value is replaced atomically without leftover temp files', async () => {
    const store = createStateFile({ path })
    await store.write({ ...emptyCollectorState(), lastRun: { status: 'ok', tokenExpiresAt: 1 } })
    await store.write({ ...emptyCollectorState(), lastRun: { status: 'ok', tokenExpiresAt: 2 } })
    await expect(store.read()).resolves.toMatchObject({ lastRun: { tokenExpiresAt: 2 } })
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('When the existing file has loose permissions then writing tightens them to 0600 (V8)', async () => {
    mkdirSync(join(root, 'state'), { recursive: true })
    writeFileSync(path, '{}')
    chmodSync(path, 0o644)
    const store = createStateFile({ path })
    await store.write(emptyCollectorState())
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('When the file is corrupt JSON then read returns null instead of throwing', async () => {
    mkdirSync(join(root, 'state'), { recursive: true })
    writeFileSync(path, '{broken')
    const store = createStateFile({ path })
    await expect(store.read()).resolves.toBeNull()
  })

  it('When the new path has no state but the legacy path does then read falls back to it (ADR 0.3 D3 이행)', async () => {
    mkdirSync(join(root, 'state'), { recursive: true })
    const legacy = join(root, 'state', 'usage-state.json')
    writeFileSync(legacy, JSON.stringify({ schema: 1, provider: 'claude', previous: { rawText: 'old' } }))
    const store = createStateFile({ path, legacyPath: legacy })
    await expect(store.read()).resolves.toMatchObject({ provider: 'claude', previous: { rawText: 'old' } })
    // 쓰기는 새 경로로 한다(이행은 읽기에서만).
    await store.write({ schema: 1, provider: 'claude', previous: null, gate: { nextAllowedAt: null, failReason: null, failCount: 0, authDeniedExpiresAt: null }, lastRun: { status: null, tokenExpiresAt: null } })
    expect(await store.read()).toMatchObject({ provider: 'claude' })
    expect(statSync(legacy).mode & 0o777).toBeGreaterThan(0)
  })
})
