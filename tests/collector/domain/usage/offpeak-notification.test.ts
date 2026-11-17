import {describe,it,expect} from 'vitest'
import {nextOffpeakEvents,formatOffpeakMessage} from '../../../../collector/domain/usage/offpeak-notification.mjs'
import {OFFPEAK_SCHEDULE} from '../../../../src/domain/usage/offpeak-schedule'
const at=Date.parse
const daily={windows:[{start:'00:00',end:'02:00'}]}
describe('Given merged off-peak boundaries in UTC',()=>{
 it('When weekday windows touch across midnight Then creates one started/ending pair',()=>{
  const schedule={opencode:OFFPEAK_SCHEDULE.opencode}
  const events=nextOffpeakEvents(schedule,at('2026-11-17T10:00:00Z'))
  expect(events).toMatchObject([{provider:'opencode',kind:'started',atMs:at('2026-11-17T10:10:00Z'),startMs:at('2026-11-17T10:00:00Z'),endMs:at('2026-11-18T01:00:00Z')}])
  expect(nextOffpeakEvents(schedule,events[0]!.atMs+1)).toMatchObject([{kind:'ending',atMs:at('2026-11-18T00:50:00Z')}])
 })
 it('When Friday joins the weekend and Monday Then never invents a weekend boundary',()=>{
  const schedule={opencode:OFFPEAK_SCHEDULE.opencode}
  const e=nextOffpeakEvents(schedule,at('2026-11-20T10:11:00Z'))
  expect(e).toMatchObject([{kind:'ending',startMs:at('2026-11-20T10:00:00Z'),endMs:at('2026-11-23T01:00:00Z'),atMs:at('2026-11-23T00:50:00Z')}])
  expect(nextOffpeakEvents({ollama:OFFPEAK_SCHEDULE.ollama},at('2026-11-20T18:11:00Z'))).toMatchObject([{kind:'ending',endMs:at('2026-11-23T12:00:00Z'),atMs:at('2026-11-23T11:50:00Z')}])
 })
 it('When a merged interval is at most 20 minutes Then skips it; adjacent short windows merge first',()=>{
  expect(nextOffpeakEvents({ollama:{windows:[{start:'00:00',end:'00:20'}]}},at('2026-11-17T00:00:00Z'))).toEqual([])
  expect(nextOffpeakEvents({ollama:{windows:[{start:'00:00',end:'00:20'},{start:'00:20',end:'00:40'}]}},at('2026-11-17T00:00:00Z'))).toMatchObject([{kind:'started',atMs:at('2026-11-17T00:10:00Z'),endMs:at('2026-11-17T00:40:00Z')}])
 })
 it('When providers share an instant Then returns one stable batch and respects excluded keys',()=>{
  const schedule={opencode:daily,ollama:daily},e=nextOffpeakEvents(schedule,at('2026-11-17T00:00:00Z'))
  expect(e.map(x=>x.provider)).toEqual(['ollama','opencode']);expect(new Set(e.map(x=>x.atMs)).size).toBe(1)
  expect(nextOffpeakEvents(schedule,e[0]!.atMs,[e[0]!.key])).toHaveLength(1)
  expect(nextOffpeakEvents(schedule,e[0]!.atMs,e.map(x=>x.key))).toMatchObject([{kind:'ending',atMs:at('2026-11-17T01:50:00Z')},{kind:'ending'}])
 })
 it('When the same instant is written as UTC or KST Then keys and boundaries are identical',()=>{
  expect(nextOffpeakEvents({ollama:daily},at('2026-11-17T09:00:00+09:00'))).toEqual(nextOffpeakEvents({ollama:daily},at('2026-11-17T00:00:00Z')))
 })
 it('When formatting Then uses KST, provider names, discount and the existing dashboard convention',()=>{
  const events=nextOffpeakEvents({opencode:OFFPEAK_SCHEDULE.opencode},at('2026-11-17T10:00:00Z'))
  const text=formatOffpeakMessage(events)
  expect(text).toContain('off-peak 시작 · OpenCode Go · 내일 10:00(KST)까지 · DeepSeek 50% 할인')
  expect(text).toContain('https://zzik.qus0in.dev')
  const ending=nextOffpeakEvents({ollama:OFFPEAK_SCHEDULE.ollama},at('2026-11-17T11:00:00Z'))
  expect(formatOffpeakMessage(ending)).toContain('off-peak 10분 후 종료 · Ollama · 21:00(KST)부터 peak')
 })
 it('When a short interval crosses KST midnight Then identifies the end date',()=>{
  const e=nextOffpeakEvents({ollama:{windows:[{start:'14:00',end:'16:00'}]}},at('2026-11-17T14:00:00Z'))
  expect(formatOffpeakMessage(e)).toContain('내일 01:00(KST)까지')
 })
 it('When the end is more than one KST day later Then displays the date and weekday',()=>{
  const e=nextOffpeakEvents({opencode:OFFPEAK_SCHEDULE.opencode},at('2026-11-20T10:00:00Z'))
  expect(formatOffpeakMessage(e)).toContain('11/23(월) 10:00(KST)까지')
 })
 it('When delivery crosses midnight Then compares the actual delivery date',()=>{
  const e=nextOffpeakEvents({ollama:{windows:[{start:'14:00',end:'15:10'}]}},at('2026-11-17T14:00:00Z'))
  expect(formatOffpeakMessage(e,at('2026-11-17T15:00:01Z'))).toContain('00:10(KST)까지')
  expect(formatOffpeakMessage(e,at('2026-11-17T15:00:01Z'))).not.toContain('내일')
 })
 it('When no finite boundary exists or time is invalid Then schedules nothing',()=>{
  expect(nextOffpeakEvents({},0)).toEqual([]);expect(nextOffpeakEvents({ollama:daily},NaN)).toEqual([])
  expect(nextOffpeakEvents({ollama:{windows:[{start:'00:00',end:'24:00'}]}},at('2026-11-17T00:00:00Z'))).toEqual([])
 })
})
