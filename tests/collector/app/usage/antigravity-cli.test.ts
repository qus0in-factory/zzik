import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'

describe('Given Antigravity dry-run CLI safety', () => {
  it('When dry-running Then no agy CLI (or token file) is used and nothing is called', () => {
    const result = spawnSync(process.execPath, ['collector/main.mjs', '--dry-run', '--provider', 'antigravity'], {
      encoding: 'utf8',
      env: { ...process.env, ZZIK_PROVIDERS: 'antigravity', ZZIK_AGY_CLI_PATH: '/nonexistent/agy' },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('status=no_credentials')
    expect(result.stdout).toContain('called=0')
  })
})
