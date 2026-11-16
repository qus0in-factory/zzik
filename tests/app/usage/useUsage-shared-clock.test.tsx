// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useUsage } from '@app/usage/useUsage'
import { usageQueryKey } from '@app/usage/usage-query'
import { makeUsageProviders } from '../../helpers/query'
import { createFakeUsageClock, createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import live from '../../fixtures/usage-history/codex.xfit-live.json'

afterEach(cleanup)

function Probe({id}:{id:string}) {
  const {state} = useUsage('codex')
  return <output data-testid={id}>{JSON.stringify({now:state.nowIso,pace:state.report?.windows[0]?.elapsedPercent})}</output>
}
function StaggeredConsumers() {
  const [open,setOpen] = useState(false)
  return <><Probe id="top" /><button onClick={()=>setOpen(true)}>Open chart</button>{open && <Probe id="chart" />}</>
}
function setup() {
  const gateway = createFakeUsageGateway()
  gateway.pushResultFor('codex',{ok:true,usage:live.raw,collection:null,rawText:null})
  const clock = createFakeUsageClock(live.now)
  const scheduler = createFakeUsageScheduler()
  const providers = makeUsageProviders({gateway,clock,scheduler})
  render(<StaggeredConsumers />,{wrapper:providers.wrapper})
  return {clock,scheduler,...providers}
}

describe('Given top chips and chart consumers mounted at different wall-clock times', () => {
  it('When a chart mounts between ticks Then both consumers use one clock and one scheduler subscription', async () => {
    const {clock,scheduler} = setup()
    await waitFor(()=>expect(screen.getByTestId('top').textContent).toContain('pace'))
    const between = new Date(Date.parse(live.now)+15_000).toISOString()
    clock.setIso(between)
    fireEvent.click(screen.getByRole('button',{name:'Open chart'}))
    expect(screen.getByTestId('chart').textContent).toBe(screen.getByTestId('top').textContent)
    expect(scheduler.pendingCount()).toBe(1)
    act(()=>scheduler.runScheduledAt(30_000))
    expect(JSON.parse(screen.getByTestId('top').textContent!).now).toBe(between)
    expect(screen.getByTestId('chart').textContent).toBe(screen.getByTestId('top').textContent)
    cleanup()
    expect(scheduler.pendingCount()).toBe(0)
  })
  it('When a newer snapshot arrives before a tick Then the shared clock advances immediately for all consumers', async () => {
    const {clock,client} = setup()
    await waitFor(()=>expect(screen.getByTestId('top').textContent).toContain('pace'))
    fireEvent.click(screen.getByRole('button',{name:'Open chart'}))
    const fetchedAt = new Date(Date.parse(live.now)+15_000).toISOString()
    clock.setIso(fetchedAt)
    act(()=>client.setQueryData(usageQueryKey('codex'),{ok:true,usage:{...live.raw, rate_limit:{...live.raw.rate_limit, primary_window:{...live.raw.rate_limit.primary_window,used_percent:87}}},collection:null,rawText:null}))
    await waitFor(()=>expect(JSON.parse(screen.getByTestId('chart').textContent!).now).toBe(fetchedAt))
    expect(screen.getByTestId('chart').textContent).toBe(screen.getByTestId('top').textContent)
  })
})
