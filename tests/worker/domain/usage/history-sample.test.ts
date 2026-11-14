import { describe, expect, it } from 'vitest';
import { historySample } from '../../../../worker/domain/usage/history-sample';
import type { HistoryRow } from '../../../../worker/domain/usage/history-store';
const row: HistoryRow = { id: '7', runAt: '2026-11-11T12:00:00.000Z', status: 'ok', fetchedAt: '2026-11-11T12:00:00.000Z', intervalSec: '900', rawText: '{"five_hour":{"utilization":4}}', rawRedacted: [] };
describe('Given a historical event row', () => {
  it('When data is readable Then only allowed sample fields escape', () => {
    const result = historySample('claude', row);
    expect(result.values).toEqual([{ id: 'five_hour', usedPercent: 4, resetsAt: null, cycleSeconds: 18000 }]);
    expect(Object.keys(result)).toEqual(['id', 'runAt', 'status', 'fetchedAt', 'intervalSec', 'values']);
    expect(JSON.stringify(result)).not.toMatch(/rawText|rawRedacted|utilization/);
  });
  it('When all values are legitimately gone Then [] means disappearance', () => {
    for (const rawText of ['{}', '{"five_hour":null}', '{"five_hour":{"utilization":4,"resets_at":"2020-01-01T00:00:00Z"}}'])
      expect(historySample('claude', { ...row, rawText }).values).toEqual([]);
    expect(historySample('claude', { ...row, rawRedacted: ['five_hour'] }).values).toEqual([]);
  });
  it('When all limits are malformed Then null means unknown', () => expect(historySample('claude', { ...row, rawText: '{"five_hour":{"utilization":"bad"}}' }).values).toBeNull());
  it.each([null, 'bad JSON', '[]'])('When rawText=%s Then values stay unknown', rawText => expect(historySample('claude', { ...row, rawText }).values).toBeNull());
  it('When the collector failed Then previous values are not scanned and fetchedAt stays unchanged', () => {
    const sample = historySample('claude', { ...row, status: 'network_error' }, () => { throw Error('must not scan'); });
    expect(sample.values).toBeNull();
    expect(sample.fetchedAt).toBe(row.fetchedAt);
  });
  it('When scanning fails or throws Then the row still retains its column cursor fields', () => {
    for (const scanner of [() => ({ ok: false as const, reason: 'invalid_shape' as const }), () => ({ ok: false as const, reason: 'scan_failed' as const }), () => { throw Error('poison'); }])
      expect(historySample('claude', row, scanner)).toMatchObject({ id: '7', runAt: row.runAt, values: null });
  });
  it('When one of multiple limits is valid Then the readable partial array survives', () => expect(historySample('claude', { ...row, rawText: '{"five_hour":{"utilization":"bad"},"seven_day":{"utilization":2}}' }).values).toHaveLength(1));
  it.each(['bad', '0', '-1', 'Infinity', null])('When intervalSec=%s Then emits null', intervalSec => expect(historySample('claude', { ...row, intervalSec }).intervalSec).toBeNull());
});
describe('Given malformed event envelope metadata', () => {
  it('When fetchedAt is not a date Then emits null without damaging column cursor fields', () => {
    expect(historySample('claude', { ...row, fetchedAt: 'not-a-date' })).toMatchObject({ id: '7', runAt: row.runAt, fetchedAt: null });
  });
});

describe('Given a throwing metadata field', () => {
  it('When metadata access fails Then a null-valued sample still carries its column cursor', () => {
    const poisoned = {...row}
    Object.defineProperty(poisoned, 'fetchedAt', {get(){throw Error('poison')}})
    expect(historySample('claude', poisoned)).toMatchObject({id:'7',runAt:row.runAt,values:null,fetchedAt:null})
  })
})
