import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
// @ts-expect-error operator script is plain ESM
import { runLedgerPreflight } from '../../scripts/ledger-preflight.mjs'
// @ts-expect-error collector module is plain ESM (typed by tsconfig.collector)
import { openSqliteLedger } from '../../collector/infra/usage/sqlite-ledger.mjs'

const dirs: string[] = []
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'zzik-preflight-')); dirs.push(d); return d }
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('Given the ledger preflight before a collector restart', () => {
  it('When there is no ledger yet Then it passes', async () => {
    expect(await runLedgerPreflight({ stateDir: dir() })).toEqual({ ok: true, reason: 'no_ledger' })
  })
  it('When the release code can open a copy Then it passes and the original is unchanged', async () => {
    const d = dir(); const l = openSqliteLedger({ directory: d, nowMs: Date.now() }) as any; l.value.close()
    const before = readFileSync(join(d, 'collector-ledger.sqlite'))
    expect(await runLedgerPreflight({ stateDir: d })).toEqual({ ok: true })
    expect(readFileSync(join(d, 'collector-ledger.sqlite')).equals(before)).toBe(true)
  })
  it('When the copy is refused (unknown provider row) Then it fails with the ledger reason', async () => {
    const d = dir(); const l = openSqliteLedger({ directory: d, nowMs: Date.now() }) as any; l.value.close()
    const db = new DatabaseSync(join(d, 'collector-ledger.sqlite')); db.exec("UPDATE provider_state SET provider='legacy-x' WHERE provider='zai'"); db.close()
    expect(await runLedgerPreflight({ stateDir: d })).toEqual({ ok: false, reason: 'ledger_start_failed' })
  })
})
