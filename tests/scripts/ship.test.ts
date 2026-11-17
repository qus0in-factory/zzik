import { describe, expect, it } from 'vitest'
import { classifyShipScope, runShip, shipMain } from '../../scripts/ship.mjs'

function makeFakeExecutor(overrides: Record<string, { exitCode?: number; stdout?: string; stderr?: string }> = {}) {
  const calls: { command: string; args: readonly string[]; cwd?: string }[] = []
  const execute = async (command: string, args: readonly string[], options: { cwd?: string } = {}) => {
    calls.push({ command, args, cwd: options.cwd })
    const key = [command, ...args].join(' ')
    for (const [pattern, result] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        return { exitCode: result.exitCode ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  return { calls, execute }
}

describe('Given ship scope classification (변경 범위 판정)', () => {
  it('When worker, src, shared or wrangler.jsonc changes Then deployWorker is true and UI sets default kind verify', () => {
    expect(classifyShipScope(['src/ui/App.tsx'])).toEqual({
      deployWorker: true,
      applyCollector: false,
      hasUi: true,
      defaultKind: 'verify',
    })
    expect(classifyShipScope(['worker/index.ts'])).toEqual({
      deployWorker: true,
      applyCollector: false,
      hasUi: false,
      defaultKind: 'done',
    })
    expect(classifyShipScope(['wrangler.jsonc'])).toEqual({
      deployWorker: true,
      applyCollector: false,
      hasUi: false,
      defaultKind: 'done',
    })
  })

  it('When collector changes Then applyCollector is true and deployWorker is false', () => {
    expect(classifyShipScope(['collector/main.mjs'])).toEqual({
      deployWorker: false,
      applyCollector: true,
      hasUi: false,
      defaultKind: 'done',
    })
  })

  it('When shared changes Then both deployWorker and applyCollector are true', () => {
    expect(classifyShipScope(['shared/usage-policy.ts'])).toEqual({
      deployWorker: true,
      applyCollector: true,
      hasUi: false,
      defaultKind: 'done',
    })
  })

  it('When only docs change Then neither worker deploy nor collector apply runs', () => {
    expect(classifyShipScope(['docs/harness/operations.md'])).toEqual({
      deployWorker: false,
      applyCollector: false,
      hasUi: false,
      defaultKind: 'done',
    })
  })
})

describe('Given scripts/ship.mjs dry-run mode (기본 dry-run)', () => {
  it('When called without --apply Then returns planned steps without running mutating commands', async () => {
    const fake = makeFakeExecutor()
    const result = await runShip({
      execute: fake.execute,
      summary: '위험 임계값 보정',
      checks: ['typecheck 통과'],
      issues: ['111'],
      changedFiles: ['src/ui/usage/PaceSummary.tsx'],
      version: '0.7.1',
    })
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.kind).toBe('verify')
    expect(result.steps.map((s) => s.name)).toEqual([
      'release_prep',
      'pr_merge',
      'release_sync',
      'deploy_worker',
      'verify_request',
      'notify_discord',
    ])
    expect(fake.calls).toHaveLength(0)
  })

  it('When --apply and --dry-run are both passed Then shipMain returns exit 64', async () => {
    const lines: string[] = []
    const code = await shipMain(['--apply', '--dry-run'], { write: (s: string) => lines.push(s) })
    expect(code).toBe(64)
    expect(JSON.parse(lines[0])).toEqual({ ok: false, dryRun: true, stage: 'arguments' })
  })
})

describe('Given scripts/ship.mjs --apply execution and scope branching', () => {
  it('When only collector files changed Then skips deploy-verify and runs collector-apply with done kind', async () => {
    const fake = makeFakeExecutor({
      'git diff --name-only': { stdout: 'collector/app/usage/diff-alerts.mjs\n' },
      'git rev-parse HEAD': { stdout: 'abc1234\n' },
    })
    const result = await runShip({
      apply: true,
      execute: fake.execute,
      summary: '수집기 알림 임계값 반영',
      checks: ['vitest 통과'],
      issues: ['111'],
      version: '0.7.1',
    })
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(false)
    expect(result.kind).toBe('done')
    const ran = fake.calls.map((c) => [c.command, ...c.args].join(' '))
    expect(ran.some((c) => c.includes('release-prep.mjs --apply'))).toBe(true)
    expect(ran.some((c) => c.includes('gh pr merge --merge'))).toBe(true)
    expect(ran.some((c) => c.includes('deploy-verify.mjs --deploy'))).toBe(false)
    expect(ran.some((c) => c.includes('collector-apply.mjs --apply'))).toBe(true)
    expect(ran.some((c) => c.includes('notify-discord.sh'))).toBe(true)
  })

  it('When shared and src changed Then runs both deploy-verify and collector-apply with verify kind', async () => {
    const fake = makeFakeExecutor({
      'git diff --name-only': { stdout: 'shared/usage-policy.ts\nsrc/ui/usage/PaceSummary.tsx\n' },
      'git rev-parse HEAD': { stdout: 'abc1234\n' },
    })
    const result = await runShip({
      apply: true,
      execute: fake.execute,
      summary: '칩 위험 색 반영',
      checks: ['typecheck 통과'],
      version: '0.7.1',
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('verify')
    const ran = fake.calls.map((c) => [c.command, ...c.args].join(' '))
    expect(ran.some((c) => c.includes('deploy-verify.mjs --deploy'))).toBe(true)
    expect(ran.some((c) => c.includes('collector-apply.mjs --apply'))).toBe(true)
  })
})

describe('Given failure handling and secret redaction (실패 중단 및 비밀값 비노출)', () => {
  it('When a stage fails Then stops immediately, reports only stage name, and hides secret outputs', async () => {
    const fake = makeFakeExecutor({
      'gh pr merge --merge': {
        exitCode: 1,
        stdout: 'secret-token-xyz',
        stderr: 'DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/secret',
      },
    })
    const lines: string[] = []
    const code = await shipMain(
      ['--apply', '--summary', '배포 테스트', '--check', '테스트 통과'],
      { execute: fake.execute, write: (s: string) => lines.push(s), version: '0.7.1' },
    )
    expect(code).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed).toEqual({ ok: false, dryRun: false, stage: 'pr_merge' })
    expect(lines[0]).not.toContain('secret-token-xyz')
    expect(lines[0]).not.toContain('DISCORD_WEBHOOK_URL')
    expect(fake.calls.some((c) => c.args.join(' ').includes('notify-discord.sh'))).toBe(false)
  })

  it('When a stage fails with --notify-failure Then sends failure notice to Discord without leaking secrets', async () => {
    const fake = makeFakeExecutor({
      'deploy-verify.mjs --deploy': {
        exitCode: 1,
        stderr: 'TOKEN=super-secret-value',
      },
      'git diff --name-only': { stdout: 'worker/index.ts\n' },
      'git rev-parse HEAD': { stdout: 'abc1234\n' },
    })
    const lines: string[] = []
    const code = await shipMain(
      ['--apply', '--notify-failure', '--summary', '워커 배포', '--check', '테스트 통과'],
      { execute: fake.execute, write: (s: string) => lines.push(s), version: '0.7.1' },
    )
    expect(code).toBe(1)
    expect(JSON.parse(lines[0])).toEqual({ ok: false, dryRun: false, stage: 'deploy_worker' })
    const notifyCall = fake.calls.find((c) => c.command.includes('notify-discord.sh'))
    expect(notifyCall).toBeDefined()
    expect(notifyCall?.args.join(' ')).toContain('deploy_worker')
    expect(notifyCall?.args.join(' ')).not.toContain('super-secret-value')
  })
})
