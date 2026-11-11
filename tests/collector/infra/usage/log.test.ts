import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogAppender, formatLogLine } from '../../../../collector/infra/usage/log.mjs'

let root: string
let path: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zzik-log-'))
  path = join(root, 'logs', 'usage-collector.log')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const ENTRY = {
  runAt: '2026-11-11T12:00:00.000Z',
  status: 'ok',
  called: true,
  httpStatus: 200,
  tokenExpiresAt: '2026-11-11T18:00:00.000Z',
  kvOk: true,
  kvReason: null,
  transition: 'token_expired→ok',
  tokenRefreshed: true,
}

describe('Given the collector log line format', () => {
  it('When formatting an entry then the run fields are all present and on one line (D2)', () => {
    const line = formatLogLine(ENTRY)
    expect(line).toContain('2026-11-11T12:00:00.000Z')
    expect(line).toContain('status=ok')
    expect(line).toContain('called=1')
    expect(line).toContain('httpStatus=200')
    expect(line).toContain('tokenExpiresAt=2026-11-11T18:00:00.000Z')
    expect(line).toContain('kv=ok')
    expect(line).toContain('transition=token_expired→ok')
    expect(line).toContain('token_refreshed')
    expect(line.split('\n')).toHaveLength(1)
  })

  it('When KV write failed then the reason rides on the kv field', () => {
    const line = formatLogLine({ ...ENTRY, kvOk: false, kvReason: 'wrangler exit 1' })
    expect(line).toContain('kv=fail:wrangler exit 1')
  })

  it('When there was no previous run then transition and refresh markers disappear', () => {
    const line = formatLogLine({ ...ENTRY, transition: null, tokenRefreshed: false })
    expect(line).not.toContain('transition=')
    expect(line).not.toContain('token_refreshed')
  })

  it('When the log is written repeatedly then lines accumulate in the file (V8: 실행당 한 줄)', async () => {
    const appender = createLogAppender({ path })
    await appender.write(ENTRY)
    await appender.write({ ...ENTRY, status: 'rate_limited' })
    const content = readFileSync(path, 'utf8')
    expect(content.trim().split('\n')).toHaveLength(2)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, 'logs')).mode & 0o777).toBe(0o700)
  })
})
