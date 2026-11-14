import { describe, expect, it } from 'vitest'
import { CHART_PREFS_KEY, createChartPrefsStore, prefsOf } from '@app/usage/history/chart-prefs-store'
import { createMemoryKeyValue } from '../../../fakes/history-ports'

const stored = (storage: ReturnType<typeof createMemoryKeyValue>): unknown => JSON.parse(storage.data.get(CHART_PREFS_KEY) ?? 'null')

describe('Given the chart prefs store (범례 설정, ADR 0.7 9절)', () => {
  it('Then the key is versioned and defaults are 7d with nothing hidden', () => {
    expect(CHART_PREFS_KEY).toBe('zzik:chart-prefs:v1')
    const store = createChartPrefsStore(createMemoryKeyValue())
    expect(prefsOf(store.getState(), 'claude')).toEqual({ hidden: [], shown: [], range: '7d' })
  })
  it('When a normal series is toggled Then its id goes to hidden and back; new series stay visible by default', () => {
    const store = createChartPrefsStore(createMemoryKeyValue())
    store.getState().toggleSeries('claude', 'seven_day_sonnet', false)
    expect(prefsOf(store.getState(), 'claude').hidden).toEqual(['seven_day_sonnet'])
    store.getState().toggleSeries('claude', 'seven_day_sonnet', false)
    expect(prefsOf(store.getState(), 'claude').hidden).toEqual([])
  })
  it('When a slot-0 series (9번째 이후) is toggled Then it goes to shown instead', () => {
    const store = createChartPrefsStore(createMemoryKeyValue())
    store.getState().toggleSeries('antigravity', 'ninth', true)
    expect(prefsOf(store.getState(), 'antigravity')).toMatchObject({ hidden: [], shown: ['ninth'] })
    store.getState().toggleSeries('antigravity', 'ninth', true)
    expect(prefsOf(store.getState(), 'antigravity').shown).toEqual([])
  })
  it('When show-all is used Then hidden is cleared and shown is kept', () => {
    const store = createChartPrefsStore(createMemoryKeyValue())
    store.getState().toggleSeries('claude', 'a', false)
    store.getState().toggleSeries('claude', 'z', true)
    store.getState().showAll('claude')
    expect(prefsOf(store.getState(), 'claude')).toMatchObject({ hidden: [], shown: ['z'] })
  })
  it('When the range is selected Then it is stored per provider', () => {
    const store = createChartPrefsStore(createMemoryKeyValue())
    store.getState().setRange('codex', '30d')
    expect(prefsOf(store.getState(), 'codex').range).toBe('30d')
    expect(prefsOf(store.getState(), 'claude').range).toBe('7d')
  })
  it('Then the stored JSON is { state: { providers }, version: 1 } and holds nothing else', () => {
    const storage = createMemoryKeyValue()
    const store = createChartPrefsStore(storage)
    store.getState().toggleSeries('claude', 'seven_day_sonnet', false)
    store.getState().setRange('claude', '24h')
    expect(stored(storage)).toEqual({ state: { providers: { claude: { hidden: ['seven_day_sonnet'], shown: [], range: '24h' } } }, version: 1 })
  })
  it('When storage holds a previous session Then it is restored (sanitized)', () => {
    const storage = createMemoryKeyValue({ [CHART_PREFS_KEY]: JSON.stringify({ state: { providers: { claude: { hidden: ['a', 7, null], range: '99d' }, codex: { hidden: [] }, unknown: { hidden: ['x'] } } }, version: 1 }) })
    const store = createChartPrefsStore(storage)
    expect(prefsOf(store.getState(), 'claude')).toEqual({ hidden: ['a'], shown: [], range: '7d' })
    expect(prefsOf(store.getState(), 'codex').range).toBe('7d')
  })
  it.each(['{oops', 'null', '[]', '"x"', JSON.stringify({ state: 5, version: 1 }), JSON.stringify({ state: { providers: 'x' }, version: 1 })])('When the stored value is broken (%s) Then defaults are used', (text) => {
    const store = createChartPrefsStore(createMemoryKeyValue({ [CHART_PREFS_KEY]: text }))
    expect(prefsOf(store.getState(), 'claude')).toEqual({ hidden: [], shown: [], range: '7d' })
  })
  it('When the stored version is old Then migrate keeps what is valid', () => {
    const store = createChartPrefsStore(createMemoryKeyValue({ [CHART_PREFS_KEY]: JSON.stringify({ state: { providers: { claude: { hidden: ['a'] } } }, version: 0 }) }))
    expect(prefsOf(store.getState(), 'claude').hidden).toEqual(['a'])
  })
  it('When a provider accumulates more than 50 ids Then the oldest are dropped (제공자당 50개)', () => {
    const store = createChartPrefsStore(createMemoryKeyValue())
    for (let i = 0; i < 55; i += 1) store.getState().toggleSeries('claude', `id${i}`, false)
    const { hidden } = prefsOf(store.getState(), 'claude')
    expect(hidden).toHaveLength(50)
    expect(hidden[0]).toBe('id5')
    expect(hidden.at(-1)).toBe('id54')
  })
  it('When another tab changes the storage Then rehydrate picks it up', async () => {
    const storage = createMemoryKeyValue()
    const store = createChartPrefsStore(storage)
    storage.data.set(CHART_PREFS_KEY, JSON.stringify({ state: { providers: { claude: { hidden: ['b'], shown: [], range: '30d' } } }, version: 1 }))
    await store.persist.rehydrate()
    expect(prefsOf(store.getState(), 'claude')).toEqual({ hidden: ['b'], shown: [], range: '30d' })
  })
  it('When the storage refuses writes Then the in-memory state still works', () => {
    const storage = createMemoryKeyValue()
    storage.failWrites = true
    const store = createChartPrefsStore(storage)
    store.getState().toggleSeries('claude', 'a', false)
    expect(prefsOf(store.getState(), 'claude').hidden).toEqual(['a'])
  })
})
