import { describe, expect, it } from 'vitest'
import { readAlertConfig } from '../../../../collector/domain/usage/alert-config.mjs'
describe('Given dedicated usage alert configuration',()=>{
 it('When only the task-report webhook exists Then usage alerts stay disabled',()=>{
  expect(readAlertConfig({DISCORD_WEBHOOK_URL:'synthetic'})).toEqual({webhookUrl:undefined,enabled:true})
 })
 it('When an alert webhook exists Then only that URL is selected',()=>{
  expect(readAlertConfig({DISCORD_WEBHOOK_URL:'task',ZZIK_ALERT_WEBHOOK_URL:'alert'})).toEqual({webhookUrl:'alert',enabled:true})
 })
 it('When ZZIK_ALERTS=0 Then force disables even a configured alert webhook',()=>{
  expect(readAlertConfig({ZZIK_ALERT_WEBHOOK_URL:'alert',ZZIK_ALERTS:'0'})).toEqual({webhookUrl:'alert',enabled:false})
 })
})
