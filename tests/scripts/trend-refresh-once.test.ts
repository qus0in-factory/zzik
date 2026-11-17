import { describe, it, expect } from 'vitest'
// @ts-expect-error The standalone JavaScript script is tested through its public port.
import { createDatabasePort } from '../../scripts/trend-refresh-once.mjs'

describe('Given a dry-run database port', () => {
  it('When writes and batches run Then no remote write is sent', async () => {
    const calls: unknown[] = []
    const local = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), all: async () => ({ success: true, results: [] }) }) }) }
    const db = createDatabasePort({ apply: false, local, remote: async (statements: unknown[]) => { calls.push(statements); return [] } })
    await db.prepare('DELETE FROM trend_aa_snapshot').bind().run()
    await db.batch([db.prepare('INSERT INTO trend_section VALUES (?)').bind('x')])
    expect(calls).toEqual([])
    expect(db.remoteWrites()).toBe(0)
  })
  it('When apply is selected Then writes reach the remote port', async () => {
    const calls: unknown[] = []
    const db = createDatabasePort({ apply: true, local: null, remote: async (statements: unknown[]) => { calls.push(statements); return [{ success: true, results: [] }] } })
    await db.prepare('DELETE FROM trend_aa_snapshot').bind().run()
    expect(calls).toHaveLength(1)
    expect(db.remoteWrites()).toBe(1)
  })
  it('When seen rows are inserted Then apply flushes chunks before a subsequent read', async () => {
    const calls: { sql: string }[][] = []
    const db = createDatabasePort({ apply: true, local: null, remote: async (statements: { sql: string }[]) => { calls.push(statements); return statements.map(() => ({ success: true, results: [] })) } })
    for (let n = 0; n < 101; n++) await db.prepare('INSERT INTO trend_model_seen VALUES (?)').bind(n).run()
    await db.prepare('SELECT * FROM trend_section').bind().all()
    expect(calls.map(c => c.length)).toEqual([100, 1, 1])
  })
  it('When a deferred batch fails Then the subsequent read fails', async () => {
    const db = createDatabasePort({ apply: true, local: null, remote: async () => { throw Error('failed') } })
    await db.prepare('INSERT INTO trend_model_seen VALUES (?)').bind(1).run()
    await expect(db.prepare('SELECT * FROM trend_section').bind().all()).rejects.toThrow('failed')
  })

})
