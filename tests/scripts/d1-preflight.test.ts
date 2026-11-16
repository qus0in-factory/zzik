import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error scripts/d1-preflight.mjs is plain ESM checked by vitest
import { runD1Preflight } from '../../scripts/d1-preflight.mjs'

interface PreflightCheck {
  name: string
  status: 'PASS' | 'FAIL'
  reason?: string
}

interface PreflightResult {
  ok: boolean
  dryRun: true
  checks: PreflightCheck[]
}

function makePorts(overrides: Record<string, unknown> = {}) {
  return {
    pm2: {
      readProcess: async () => ({ ok: true as const, value: { status: 'stopped', zzikStore: 'postgres' } }),
    },
    ledger: {
      inspect: async () => ({ ok: true as const, value: { exists: true, marker: 'active' as const, outboxCount: 0 } }),
    },
    worker: {
      readDeployment: async () => ({
        ok: true as const,
        value: { exportDeployed: true, bucketDeployed: true, usageReadStore: 'postgres' },
      }),
    },
    ...overrides,
  }
}

describe('Given the dry-run D1 cutover preflight script', () => {
  it('When all 6 checks satisfy cutover preconditions Then returns ok: true with PASS for every check and no secret values', async () => {
    const result = (await runD1Preflight(makePorts(), {
      stateDir: '/var/lib/zzik-fake',
      expectedPm2Status: 'stopped',
      expectedZzikStore: 'postgres',
      expectedReadStore: 'postgres',
    })) as PreflightResult

    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.checks.map((c) => [c.name, c.status])).toEqual([
      ['pm2_process', 'PASS'],
      ['zzik_store', 'PASS'],
      ['ledger_exists', 'PASS'],
      ['ledger_outbox_zero', 'PASS'],
      ['export_bucket_deployed', 'PASS'],
      ['usage_read_store', 'PASS'],
    ])
  })

  it('When PM2 is still running or ZZIK_STORE mismatches Then only the corresponding checks FAIL', async () => {
    const result = (await runD1Preflight(
      makePorts({
        pm2: { readProcess: async () => ({ ok: true as const, value: { status: 'online', zzikStore: 'kv' } }) },
      }),
      { stateDir: '/var/lib/zzik-fake', expectedPm2Status: 'stopped', expectedZzikStore: 'postgres' },
    )) as PreflightResult

    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'FAIL' })
    expect(result.checks.find((c) => c.name === 'zzik_store')).toMatchObject({ status: 'FAIL' })
  })

  it('When ledger is missing or outbox is non-zero Then ledger checks FAIL', async () => {
    const missing = (await runD1Preflight(
      makePorts({
        ledger: { inspect: async () => ({ ok: true as const, value: { exists: false, marker: null, outboxCount: 0 } }) },
      }),
      { stateDir: '/var/lib/zzik-fake' },
    )) as PreflightResult
    expect(missing.ok).toBe(false)
    expect(missing.checks.find((c) => c.name === 'ledger_exists')).toMatchObject({ status: 'FAIL', reason: 'ledger_missing' })
    expect(missing.checks.find((c) => c.name === 'ledger_outbox_zero')).toMatchObject({ status: 'FAIL', reason: 'ledger_missing' })

    const nonEmpty = (await runD1Preflight(
      makePorts({
        ledger: { inspect: async () => ({ ok: true as const, value: { exists: true, marker: 'active' as const, outboxCount: 3 } }) },
      }),
      { stateDir: '/var/lib/zzik-fake' },
    )) as PreflightResult
    expect(nonEmpty.ok).toBe(false)
    expect(nonEmpty.checks.find((c) => c.name === 'ledger_outbox_zero')).toMatchObject({ status: 'FAIL' })
  })

  it('When export/bucket is not deployed or USAGE_READ_STORE mismatches Then worker checks FAIL', async () => {
    const result = (await runD1Preflight(
      makePorts({
        worker: {
          readDeployment: async () => ({
            ok: true as const,
            value: { exportDeployed: true, bucketDeployed: false, usageReadStore: 'd1' },
          }),
        },
      }),
      { stateDir: '/var/lib/zzik-fake', expectedReadStore: 'postgres' },
    )) as PreflightResult

    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'export_bucket_deployed')).toMatchObject({ status: 'FAIL' })
    expect(result.checks.find((c) => c.name === 'usage_read_store')).toMatchObject({ status: 'FAIL' })
  })

  it('When a port hangs past timeoutMs Then Node timer fails pm2 and zzik_store safely without shell timeout', async () => {
    const result = (await runD1Preflight(
      makePorts({
        pm2: { readProcess: () => new Promise(() => {}) },
      }),
      { stateDir: '/var/lib/zzik-fake', timeoutMs: 20 },
    )) as PreflightResult

    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'FAIL', reason: 'timeout' })
    expect(result.checks.find((c) => c.name === 'zzik_store')).toMatchObject({ status: 'FAIL', reason: 'timeout' })
  })

  it('When ledger or worker port is unavailable Then its checks FAIL with fixed reasons and no raw error', async () => {
    const ledgerSecret = 'postgresql://user:supersecret@db.example.com/zzik'
    const ledger = (await runD1Preflight(
      makePorts({ ledger: { inspect: async () => ({ ok: false as const, reason: ledgerSecret }) } }),
      { stateDir: '/var/lib/zzik-fake' },
    )) as PreflightResult
    expect(ledger.checks.find((c) => c.name === 'ledger_exists')).toMatchObject({ status: 'FAIL', reason: 'ledger_unavailable' })
    expect(ledger.checks.find((c) => c.name === 'ledger_outbox_zero')).toMatchObject({ status: 'FAIL', reason: 'ledger_unavailable' })

    const workerSecret = 'wrangler secret token=supersecret'
    const worker = (await runD1Preflight(
      makePorts({ worker: { readDeployment: async () => ({ ok: false as const, reason: workerSecret }) } }),
      { stateDir: '/var/lib/zzik-fake' },
    )) as PreflightResult
    expect(worker.checks.find((c) => c.name === 'export_bucket_deployed')).toMatchObject({ status: 'FAIL', reason: 'worker_unavailable' })
    expect(worker.checks.find((c) => c.name === 'usage_read_store')).toMatchObject({ status: 'FAIL', reason: 'worker_unavailable' })
    expect(JSON.stringify(worker)).not.toContain('supersecret')
  })

  it('When a port fails with a secret-like error string Then output never echoes raw secrets or connection strings', async () => {
    const secret = 'postgresql://user:supersecret@db.example.com/zzik'
    const result = (await runD1Preflight(
      makePorts({
        pm2: { readProcess: async () => ({ ok: false as const, reason: secret }) },
      }),
      { stateDir: '/var/lib/zzik-fake' },
    )) as PreflightResult

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('supersecret')
    expect(serialized).not.toContain('postgresql://')
    expect(result.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'FAIL', reason: 'pm2_unavailable' })
  })
})


describe('Given the preflight CLI branches', () => {
  const SCRIPT = fileURLToPath(new URL('../../scripts/d1-preflight.mjs', import.meta.url))
  const tmp = () => mkdtempSync(join(tmpdir(), 'zzik-preflight-'))
  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

  it('When online PG has never created a D1 ledger Then default pre-cutover checks pass without creating one',()=>{
    const dir=tmp()
    try{
      const evidence=join(dir,'evidence.json');writeFileSync(evidence,JSON.stringify({pm2:{status:'online',zzikStore:'postgres'},worker:{exportDeployed:true,bucketDeployed:true,usageReadStore:'postgres'}}))
      const result=run(['--state-dir',dir,'--evidence',evidence]);expect(result.status).toBe(0)
      const body=JSON.parse(result.stdout) as PreflightResult;expect(body.ok).toBe(true);expect(body.checks.every(c=>c.status==='PASS')).toBe(true)
      expect(body.checks.find(c=>c.name==='ledger_exists')).toMatchObject({reason:'initial_postgres_no_ledger'})
      expect(readdirSync(dir)).toEqual(['evidence.json'])
    }finally{rmSync(dir,{recursive:true,force:true})}
  })

  it('When a marker exists or a ledger file is empty/corrupt Then never treats it as initial PG absence',()=>{
    for(const state of ['marker','empty','corrupt']){
      const dir=tmp()
      try{
        const evidence=join(dir,'evidence.json');writeFileSync(evidence,JSON.stringify({pm2:{status:'online',zzikStore:'postgres'},worker:{exportDeployed:true,bucketDeployed:true,usageReadStore:'postgres'}}))
        if(state==='marker')writeFileSync(join(dir,'collector-ledger.marker.json'),'{"status":"active"}')
        else writeFileSync(join(dir,'collector-ledger.sqlite'),state==='empty'?'':'not sqlite')
        const result=run(['--state-dir',dir,'--evidence',evidence]);expect(result.status).toBe(1)
        const body=JSON.parse(result.stdout) as PreflightResult;expect(body.checks.find(c=>c.name==='ledger_exists')?.status).toBe('FAIL');expect(body.checks.find(c=>c.name==='ledger_outbox_zero')?.status).toBe('FAIL')
      }finally{rmSync(dir,{recursive:true,force:true})}
    }
  })

  it('When --help is requested Then prints the expected-value flags and exits 0', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('--expected-zzik-store')
    expect(result.stdout).toContain('--expected-read-store')
    expect(result.stdout).toContain('--expected-pm2-status')
  })

  it('When arguments are invalid Then exits 64 without running checks', () => {
    for (const args of [[], ['--unknown'], ['--expected-zzik-store'], ['--expected-zzik-store', 'kv']] as const) {
      const result = run(args as unknown as string[])
      expect(result.status).toBe(64)
      const body = JSON.parse(result.stdout)
      expect(body).toMatchObject({ ok: false, dryRun: true })
    }
  })

  it('When evidence is missing Then exits 1 with a fixed preflight_failed output', () => {
    const dir = tmp()
    try {
      const result = run(['--state-dir', dir, '--evidence', join(dir, 'missing.json')])
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toEqual({ ok: false, dryRun: true, reason: 'preflight_failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('When the evidence already says d1 and the CLI defaults are pre-cutover Then store checks FAIL', () => {
    const dir = tmp()
    try {
      const evidence = join(dir, 'evidence.json')
      writeFileSync(evidence, JSON.stringify({
        pm2: { status: 'online', zzikStore: 'd1' },
        worker: { exportDeployed: true, bucketDeployed: true, usageReadStore: 'd1' },
      }))
      const result = run(['--state-dir', dir, '--evidence', evidence])
      expect(result.status).toBe(1)
      const body = JSON.parse(result.stdout) as PreflightResult
      expect(body.ok).toBe(false)
      expect(body.checks.find((c) => c.name === 'zzik_store')).toMatchObject({ status: 'FAIL' })
      expect(body.checks.find((c) => c.name === 'usage_read_store')).toMatchObject({ status: 'FAIL' })
      expect(body.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'PASS' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('When the expected PM2 status flag differs from evidence Then pm2_process uses the passed expectation', () => {
    const dir = tmp()
    try {
      const evidence = join(dir, 'evidence.json')
      writeFileSync(evidence, JSON.stringify({
        pm2: { status: 'online', zzikStore: 'postgres' },
        worker: { exportDeployed: true, bucketDeployed: true, usageReadStore: 'postgres' },
      }))
      const result = run(['--state-dir', dir, '--evidence', evidence, '--expected-pm2-status', 'stopped'])
      const body = JSON.parse(result.stdout) as PreflightResult
      expect(body.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'FAIL', reason: 'pm2_status_mismatch' })
      expect(result.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('When the expected-value flags select d1 Then those checks use the passed expectations', () => {
    const dir = tmp()
    try {
      const evidence = join(dir, 'evidence.json')
      writeFileSync(evidence, JSON.stringify({
        pm2: { status: 'online', zzikStore: 'd1' },
        worker: { exportDeployed: true, bucketDeployed: true, usageReadStore: 'd1' },
      }))
      const result = run(['--state-dir', dir, '--evidence', evidence, '--expected-zzik-store', 'd1', '--expected-read-store', 'd1'])
      const body = JSON.parse(result.stdout) as PreflightResult
      expect(body.checks.find((c) => c.name === 'zzik_store')).toMatchObject({ status: 'PASS' })
      expect(body.checks.find((c) => c.name === 'usage_read_store')).toMatchObject({ status: 'PASS' })
      expect(body.checks.find((c) => c.name === 'ledger_exists')).toMatchObject({ status: 'FAIL' })
      expect(body.checks.find((c) => c.name === 'ledger_outbox_zero')).toMatchObject({ status: 'FAIL' })
      expect(result.status).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
