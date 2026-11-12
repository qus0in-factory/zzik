import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
describe('Given Antigravity dry-run CLI safety', () => {
  it.each([['expired','token_expired'],['apikey-like','no_credentials']])('When using synthetic %s credentials Then makes no upstream call or write', (name,status) => {
    const result=spawnSync(process.execPath,['collector/main.mjs','--dry-run','--provider','antigravity','--credentials-file','tests/fixtures/antigravity-auth.'+name+'.json'],{encoding:'utf8',env:{...process.env,ZZIK_PROVIDERS:'antigravity'}})
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('status='+status)
    expect(result.stdout).toContain('called=0')
    expect(result.stdout).not.toContain('fake-expired')
  })
  it('When host is not allowlisted Then exits 78 before any credential or API work', () => {
    const result=spawnSync(process.execPath,['collector/main.mjs','--dry-run','--provider','antigravity'],{encoding:'utf8',env:{...process.env,ZZIK_ANTIGRAVITY_API_HOST:'invalid.example'}})
    expect(result.status).toBe(78)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Invalid Antigravity API host')
  })
})
