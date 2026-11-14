// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { UsageDashboard } from '@ui/usage/UsageDashboard'
import { UsageGatewayProvider } from '@app/usage/UsageGatewayContext'
import { createFakeUsageGateway, createFakeUsageScheduler } from '../../fakes/usage-ports'
import { ViewModeProvider } from '@app/usage/ViewModeContext'
import { createViewModeStore } from '@app/usage/view-mode-store'
import { buildUsageView } from '@domain/usage/view'
const now=new Date('2026-11-14T00:00:00Z')
afterEach(cleanup)
describe('Given additional spend in Claude section',()=>{
 it.each(['cards','list'] as const)('When %s view renders Then spend appears as one footer row without a bar, reset or quota row',mode=>{
  const report=buildUsageView({five_hour:{utilization:10},extra_usage:{is_enabled:false,spend_limit_reached:true,utilization:100,used_credits:234567,monthly_limit:123456,currency:'TEST',decimal_places:2}},{now})
  const store=createViewModeStore(null)
  store.getState().setMode(mode === 'cards' ? 'grid' : 'list')
  render(<UsageGatewayProvider deps={{gateway:createFakeUsageGateway(),clock:{nowIso:()=>now.toISOString()},scheduler:createFakeUsageScheduler()}}><ViewModeProvider store={store}><UsageDashboard provider="claude" status="ready" report={report} errorMessage={null}/></ViewModeProvider></UsageGatewayProvider>)
  const row=screen.getByTestId('extra-spend')
  expect(within(row).getByText('추가 지출')).toBeTruthy()
  expect(within(row).getByText('비활성')).toBeTruthy()
  expect(within(row).getByText('지출 한도 도달')).toBeTruthy()
  expect(within(row).getByText('소진율 100%')).toBeTruthy()
  expect(within(row).queryByRole('progressbar')).toBeNull()
  expect(row.textContent).not.toMatch(/123456|234567|TEST|리셋/)
  expect(document.querySelector('[data-card-id="extra_usage"]')).toBeNull()
  expect(document.querySelector('[data-row-id="extra_usage"]')).toBeNull()
 })
 it('When only spending information is present Then shows the row and no artificial limit card',()=>{
  const report=buildUsageView({extra_usage:{is_enabled:true,utilization:null}},{now})
  render(<UsageDashboard provider="claude" status="ready" report={report} errorMessage={null}/>)
  expect(screen.queryAllByTestId('usage-card')).toHaveLength(0)
  expect(within(screen.getByTestId('extra-spend')).getByText('활성')).toBeTruthy()
  expect(within(screen.getByTestId('extra-spend')).getByText('정보 없음')).toBeTruthy()
 })
})
