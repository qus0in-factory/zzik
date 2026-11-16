import { describe, expect, it } from 'vitest'
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
    expect(missing.checks.find((c) => c.name === 'ledger_exists')).toMatchObject({ status: 'FAIL' })

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

  it('When a port hangs past timeoutMs Then Node timer fails the check safely without shell timeout', async () => {
    const result = (await runD1Preflight(
      makePorts({
        pm2: { readProcess: () => new Promise(() => {}) },
      }),
      { stateDir: '/var/lib/zzik-fake', timeoutMs: 20 },
    )) as PreflightResult

    expect(result.ok).toBe(false)
    expect(result.checks.find((c) => c.name === 'pm2_process')).toMatchObject({ status: 'FAIL', reason: 'timeout' })
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
