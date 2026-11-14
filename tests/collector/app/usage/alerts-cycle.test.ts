import { describe, expect, it } from 'vitest'
import { runCycle } from '../../../../collector/app/usage/run-cycle.mjs'
import { runOnce } from '../../../../collector/app/usage/run-once.mjs'
import { createFakeCollectorPorts, COLLECTOR_NOW } from '../../../fakes/collector-ports'
const reset = new Date(COLLECTOR_NOW + 9_000_000).toISOString()
const body = (used: number, provider = 'claude') => JSON.stringify(provider === 'claude' ? { five_hour:{utilization:used,resets_at:reset} } : {rate_limit:{primary_window:{used_percent:used,limit_window_seconds:18000,reset_at:Date.parse(reset)/1000}}})
function queue(ports: ReturnType<typeof createFakeCollectorPorts>, used: number, provider = 'claude') {
  ports.credentials.queueReads([{source:'file',token:'synthetic-secret',expiresAt:null}])
  ports.usage.queueUsage({ok:true,bodyText:body(used,provider),httpStatus:200,retryAfterSec:null})
}

describe('Given collector alert orchestration', () => {
  it('When two providers change in one cycle Then sends one batch after checkpoints and does not duplicate after restart', async () => {
    const a = createFakeCollectorPorts(), b = createFakeCollectorPorts()
    const batches: unknown[][] = []
    const deps = { alerts:{send:async (events: unknown[]) => { if(events.length) batches.push(events); return {status:'sent',count:events.length} }} }
    const providers = [{id:'claude',ports:a},{id:'codex',ports:b}]
    queue(a,10);queue(b,10,'codex')
    await runCycle(deps,providers)
    expect(batches).toHaveLength(0)
    a.clock.advance(900_000);b.clock.advance(900_000)
    queue(a,75);queue(b,75,'codex')
    await runCycle(deps,providers)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    const restarted = createFakeCollectorPorts(JSON.parse(JSON.stringify(a.state.snapshot())))
    queue(restarted,75)
    await runCycle(deps,[{id:'claude',ports:restarted}])
    expect(batches).toHaveLength(1)
    expect(JSON.stringify(batches)).not.toContain('synthetic-secret')
  })
  it('When persistence fails Then does not emit or advance the alert baseline', async () => {
    const p = createFakeCollectorPorts();queue(p,10);await runOnce(p)
    const baseline = (p.state.snapshot() as {alerts:unknown}).alerts
    queue(p,75);p.store.queueResult({ok:false,httpStatus:null,message:'SyntheticError'})
    expect(await runOnce(p)).toEqual({exitCode:3})
    expect((p.state.snapshot() as {alerts:unknown}).alerts).toEqual(baseline)
    queue(p,75)
    expect(await runOnce(p)).toMatchObject({alerts:[{to:'caution'}]})
  })
  it('When collection fails or parsing is invalid Then preserves the alert baseline', async () => {
    const p = createFakeCollectorPorts();queue(p,95);await runOnce(p)
    const baseline = (p.state.snapshot() as {alerts:unknown}).alerts
    await runOnce(p)
    expect((p.state.snapshot() as {alerts:unknown}).alerts).toEqual(baseline)
    p.credentials.queueReads([{source:'file',token:'synthetic',expiresAt:null}])
    p.usage.queueUsage({ok:true,bodyText:'bad json',httpStatus:200,retryAfterSec:null})
    expect(await runOnce(p)).toEqual({exitCode:0})
    expect((p.state.snapshot() as {alerts:unknown}).alerts).toEqual(baseline)
  })
  it('When delivery throws Then collection stays successful with a durable duplicate checkpoint', async () => {
    const p = createFakeCollectorPorts();queue(p,10);await runOnce(p);queue(p,75)
    const result = await runCycle({alerts:{send:async () => {throw Error('private webhook failure')}}},[{id:'claude',ports:p}])
    expect(result.exitCode).toBe(0)
    queue(p,75)
    expect(await runOnce(p)).toEqual({exitCode:0})
  })
  it('When dry-running Then previews without checkpoint writes or actual sending', async () => {
    const p = createFakeCollectorPorts();queue(p,10);await runOnce(p)
    const baseline = p.state.snapshot(), writes = p.state.writeCount()
    let previewCount=0
    queue(p,75)
    await runCycle({alerts:{send:async (events,options) => {expect(options?.dryRun).toBe(true);previewCount=events.length;return {status:'dry_run',count:events.length}}}},[{id:'claude',ports:p}],{dryRun:true})
    expect(previewCount).toBe(1)
    expect(p.state.writeCount()).toBe(writes)
    expect(p.state.snapshot()).toEqual(baseline)
  })
})
