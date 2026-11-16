import {describe,it,expect} from 'vitest'
import {Readable,Writable} from 'node:stream'
import {readConfirmation} from '../../scripts/d1-backfill.mjs'
import {spawnSync} from 'node:child_process'
describe('Given the opt-in backfill command with no approved remote configuration',()=>{
 it('When help or apply without an explicit state directory is invoked Then exits before opening any store and prints no credentials',()=>{
  const env={...process.env,DB_URL:'postgres://synthetic-secret',ZZIK_D1_API_TOKEN:'synthetic-secret'}
  const help=spawnSync(process.execPath,['scripts/d1-backfill.mjs','--help'],{encoding:'utf8',timeout:10000,env});expect(help.status).toBe(0);expect(help.stdout).toContain('Default: read-only dry-run')
  const apply=spawnSync(process.execPath,['scripts/d1-backfill.mjs','--apply'],{encoding:'utf8',timeout:10000,env});expect(apply.status).toBe(64);expect(apply.stdout).toContain('state_directory_required');expect(apply.stdout+apply.stderr).not.toContain('synthetic-secret')
 })
})


describe('Given the backfill CLI confirmation prompt', () => {
  it('When stdin carries the typed APPLY line Then the CLI confirmation path returns it unchanged', async () => {
    const hash = 'a'.repeat(64)
    const output = new Writable({ write(_chunk, _encoding, callback) { callback() } })
    const input = Readable.from([`APPLY ${hash}\n`])
    await expect(readConfirmation({ input, output, planSha256: hash })).resolves.toBe(`APPLY ${hash}`)
  })
})

import {planBackfill} from '../../collector/domain/usage/d1-backfill.mjs'
import {backfillCliSource} from '../fakes/backfill-cli-source'
import {successValue} from '../fakes/d1-contract'
describe('Given a spawned --apply command wired only to explicit fake ports',()=>{
 it('When stdin confirms this plan Then prompts and writes; wrong/empty input and missing --apply write nothing',()=>{
  const hash=successValue(planBackfill(backfillCliSource())).summary.planSha256
  const run=(input:string,apply=true)=>spawnSync(process.execPath,['tests/fixtures/collector/backfill-cli-harness.mjs',...(apply?['--apply']:[]),'--state-dir','/synthetic-unused'],{input,encoding:'utf8',timeout:10000})
  const correct=run(`APPLY ${hash}\n`);expect(correct.status).toBe(0);expect(correct.stderr).toContain(`type APPLY ${hash}`);expect(correct.stdout).toContain('"testWrites":1')
  for(const input of ['no\n','']){const refused=run(input);expect(refused.status).toBe(1);expect(refused.stdout).toContain('"testWrites":0')}
  const dry=run(`APPLY ${hash}\n`,false);expect(dry.status).toBe(0);expect(dry.stdout).toContain('"testWrites":0');expect(dry.stderr).not.toContain('Confirm collector')
 })
})

describe('Given an explicitly selected Wrangler OAuth destination',()=>{
 it('When no D1 API credentials are supplied Then still dry-runs through the injected backfill ports',()=>{
  const result=spawnSync(process.execPath,['tests/fixtures/collector/backfill-cli-harness.mjs','--state-dir','/synthetic-unused','--transport','wrangler','--database','zzik-usage'],{encoding:'utf8',timeout:10000})
  expect(result.status).toBe(0);expect(result.stdout).toContain('"dryRun":true');expect(result.stdout).toContain('"testWrites":0')
 })
})
