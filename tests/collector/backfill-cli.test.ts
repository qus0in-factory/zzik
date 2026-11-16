import {describe,it,expect} from 'vitest'
import {spawnSync} from 'node:child_process'
describe('Given the opt-in backfill command with no approved remote configuration',()=>{
 it('When help or apply without an explicit state directory is invoked Then exits before opening any store and prints no credentials',()=>{
  const env={...process.env,DB_URL:'postgres://synthetic-secret',ZZIK_D1_API_TOKEN:'synthetic-secret'}
  const help=spawnSync(process.execPath,['scripts/d1-backfill.mjs','--help'],{encoding:'utf8',timeout:10000,env});expect(help.status).toBe(0);expect(help.stdout).toContain('Default: read-only dry-run')
  const apply=spawnSync(process.execPath,['scripts/d1-backfill.mjs','--apply'],{encoding:'utf8',timeout:10000,env});expect(apply.status).toBe(64);expect(apply.stdout).toContain('state_directory_required');expect(apply.stdout+apply.stderr).not.toContain('synthetic-secret')
 })
})
