import { describe, expect, it } from 'vitest'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { runCycle } from '../../../../collector/app/usage/run-cycle.mjs'
import normalRaw from '../../../fixtures/claude-usage.normal.json'
import type { FakeCredentialRead } from '../../../fakes/collector-ports'
import { COLLECTOR_NOW, createFakeCollectorPorts } from '../../../fakes/collector-ports'

const SUCCESS_BODY = JSON.stringify(normalRaw)
const futureExpiresAt = Date.parse('2026-11-11T18:00:00.000Z')

type Ports = ReturnType<typeof createFakeCollectorPorts>

function makeProviderPorts(
  provider: string,
  setup: (ports: Ports) => void = (): void => {},
): { id: string, ports: Ports } {
  const ports = createFakeCollectorPorts()
  ports.credentials.queueReads([
    { source: provider, token: `${provider}-access-token`, expiresAt: futureExpiresAt } as FakeCredentialRead,
  ])
  ports.usage.queueUsage({ ok: true, bodyText: SUCCESS_BODY, httpStatus: 200, retryAfterSec: null })
  setup(ports)
  return { id: provider, ports }
}

describe('Given the provider run cycle (ADR 0.3 D3)', () => {
  /** 가짜 포트 구조를 런타임 계약(CollectorPorts)으로 맞춘다 — 구조는 테스트 계약으로 고정한다. */
  it('When the cycle runs then providers execute in order and each writes its own envelope once', async () => {
    const claude = makeProviderPorts('claude')
    const codex = makeProviderPorts('codex')
    const { results, exitCode } = await runCycle({ runOnce }, [claude, codex] as never)
    expect(results.map((r) => r.id)).toEqual(['claude', 'codex'])
    expect(claude.ports.kv.calls).toBe(1)
    expect(codex.ports.kv.calls).toBe(1)
    expect(JSON.parse(claude.ports.kv.writes[0] as string).provider).toBe('claude')
    expect(JSON.parse(codex.ports.kv.writes[0] as string).provider).toBe('codex')
    expect(exitCode).toBe(0)
  })

  it('When one provider throws then the other still runs and the exit code reflects the failure', async () => {
    const claude = makeProviderPorts('claude')
    const codex = makeProviderPorts('codex')
    const deps = {
      runOnce: async (ports: Ports, options: { provider?: string }): Promise<{ exitCode: number }> => {
        if (options.provider === 'claude') throw new Error('boom')
        return runOnce(ports, options) as Promise<{ exitCode: number }>
      },
    }
    const { results, exitCode } = await runCycle({ runOnce: deps.runOnce as never }, [claude, codex] as never)
    expect(results[0]).toMatchObject({ id: 'claude', exitCode: 4 })
    expect(codex.ports.kv.calls).toBe(1)
    expect(exitCode).toBe(4)
    // 예외 격리 로그가 상태 유지에 방해되지 않는다 — 로거에 기록만 남는다.
    expect(claude.ports.logger.entries[0]).toMatchObject({ provider: 'claude', status: 'cycle_error' })
  })

  it('When one provider is rate limited then the other provider is not blocked (상태 격리)', async () => {
    const claude = makeProviderPorts('claude', (ports) => {
      ports.state.write({
        schema: 1,
        provider: 'claude',
        previous: null,
        gate: { nextAllowedAt: COLLECTOR_NOW + 600_000, failReason: 'rate_limited', failCount: 1, authDeniedExpiresAt: null },
        lastRun: { status: 'rate_limited', tokenExpiresAt: null },
      })
    })
    const codex = makeProviderPorts('codex')
    const { results } = await runCycle({ runOnce }, [claude, codex] as never)
    expect(claude.ports.usage.calls).toBe(0) // claude는 게이트로 건너뛴다
    expect(codex.ports.usage.calls).toBe(1) // codex는 영향받지 않는다
    expect(results.map((r) => r.exitCode)).toEqual([0, 0])
  })

  it('When a provider KV write fails then the exit code is the max of the per-provider results', async () => {
    const claude = makeProviderPorts('claude', (ports) => {
      ports.kv.queueResult({ ok: false, httpStatus: 403, message: 'forbidden' })
    })
    const codex = makeProviderPorts('codex')
    const { results, exitCode } = await runCycle({ runOnce }, [claude, codex] as never)
    expect(results.map((r) => r.exitCode)).toEqual([3, 0])
    expect(exitCode).toBe(3)
  })
})

describe('Given the cycle budget (v2: 주기 예산 240초)', () => {
  it('When the budget is exhausted before a provider starts then it is skipped with a log and counts as 0', async () => {
    let nowMs = COLLECTOR_NOW
    const clock = { now: (): number => nowMs }
    const claude = makeProviderPorts('claude')
    const codex = makeProviderPorts('codex')
    const slowRun = async (ports: Ports, options: { provider?: string }): Promise<{ exitCode: number }> => {
      if (options.provider === 'claude') nowMs += 250_000 // claude 실행이 예산을 다 쓴다
      return runOnce(ports, options) as Promise<{ exitCode: number }>
    }
    const { results, exitCode } = await runCycle({ runOnce: slowRun as never, clock }, [claude, codex] as never, { cycleBudgetMs: 240_000 })
    expect(claude.ports.usage.calls).toBe(1)
    expect(codex.ports.usage.calls).toBe(0) // 예산 초과로 건너뜀
    expect(codex.ports.kv.calls).toBe(0)
    expect(codex.ports.logger.entries[0]).toMatchObject({ provider: 'codex', status: 'skipped_budget' })
    expect(results[1]).toMatchObject({ id: 'codex', exitCode: 0, skippedBudget: true })
    expect(exitCode).toBe(0)
  })

  it('When both providers fit the budget then nothing is skipped', async () => {
    const claude = makeProviderPorts('claude')
    const codex = makeProviderPorts('codex')
    const { results } = await runCycle({ clock: { now: () => COLLECTOR_NOW } }, [claude, codex])
    expect(results.every((result) => result.skippedBudget === undefined)).toBe(true)
  })
})

describe('Given a three-provider cycle', () => {
  it('When all are within budget Then writes each provider once in order', async () => {
    const providers=['claude','codex','antigravity'].map(id=>makeProviderPorts(id))
    const {results}=await runCycle({},providers)
    expect(results.map(result=>result.id)).toEqual(['claude','codex','antigravity'])
    for(const provider of providers) {
      expect(provider.ports.kv.calls).toBe(1)
      expect(JSON.parse(provider.ports.kv.writes[0]).provider).toBe(provider.id)
    }
  })
  it('When two providers exhaust the budget Then skips the third without API or KV calls', async () => {
    let now=COLLECTOR_NOW
    const providers=['claude','codex','antigravity'].map(id=>makeProviderPorts(id))
    const {results}=await runCycle({clock:{now:()=>now},runOnce:async(ports,options)=>{now+=121_000;return runOnce(ports,options)}},providers,{cycleBudgetMs:240_000})
    expect(results[2]).toMatchObject({id:'antigravity',skippedBudget:true})
    expect(providers[2].ports.usage.calls).toBe(0)
    expect(providers[2].ports.kv.calls).toBe(0)
  })
})
