import { describe, expect, it } from 'vitest';
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts';
const options = { fetchedAt: '2026-11-11T12:00:00.000Z', rawRedacted: [] as string[] };
describe('Given shared usage scans', () => {
  it('When scoped and legacy limits coexist Then scoped values win with the weekly cycle', () => {
    expect(scanUsageSeries('claude', { five_hour: { utilization: 12 }, seven_day_fable: { utilization: 1 }, limits: [{ kind: 'weekly_scoped', percent: 80, scope: { model: { display_name: 'Fable' } }, resets_at: '2026-11-20T00:00:00Z' }] }, options)).toEqual({ ok: true, skipped: 0, series: [{ id: 'five_hour', usedPercent: 12, resetsAt: null, cycleSeconds: 18000 }, { id: 'seven_day_fable', usedPercent: 80, resetsAt: '2026-11-20T00:00:00Z', cycleSeconds: 604800 }] });
  });
  it('When limits are absent, hidden or expired Then zero series is a successful complete scan', () => {
    for (const raw of [{}, { seven_day_opus: null }, { five_hour: { utilization: 1, resets_at: '2026-11-01T00:00:00Z' } }])
      expect(scanUsageSeries('claude', raw, options)).toEqual({ ok: true, series: [], skipped: 0 });
    expect(scanUsageSeries('claude', { five_hour: { utilization: 1 } }, { ...options, rawRedacted: ['five_hour'] })).toEqual({ ok: true, series: [], skipped: 0 });
  });
  it('When one limit is broken Then valid values survive and skipped counts the broken limit', () => {
    expect(scanUsageSeries('claude', { five_hour: { utilization: 'bad' }, seven_day: { utilization: 2 } }, options)).toMatchObject({ ok: true, skipped: 1, series: [{ id: 'seven_day', usedPercent: 2 }] });
  });
  it.each(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama', 'zai'] as const)('When %s receives nonobjects Then shape failure is not an empty successful scan', provider => {
    for (const raw of [null, undefined, 1, 'x', []])
      expect(scanUsageSeries(provider, raw, options)).toEqual({ ok: false, reason: 'invalid_shape' });
  });
  it('When window structures are missing Then shape failure is explicit', () => {
    for (const provider of ['antigravity', 'grok', 'opencode', 'zai'] as const)
      expect(scanUsageSeries(provider, {}, options)).toEqual({ ok: false, reason: 'invalid_shape' });
  });
  it('When a property getter throws Then scan_failed contains the failure', () => {
    expect(scanUsageSeries('claude', new Proxy({}, { ownKeys() { throw Error('poison'); } }), options)).toEqual({ ok: false, reason: 'scan_failed' });
  });
  it('When an additional Codex limit has a duration Then the scan retains it', () => {
    expect(scanUsageSeries('codex', { other: { used_percent: 3, limit_window_seconds: 123 } }, options)).toMatchObject({ ok: true, series: [{ id: 'other', usedPercent: 3, cycleSeconds: 123 }] });
  });
});
describe('Given unusual inputs at the scanner boundary', () => {
  it('When special keys, large strings, deep nests, bad dates or an unknown provider arrive Then no exception escapes', () => {
    const special = JSON.parse('{"__proto__":{"utilization":4},"constructor":{"utilization":2},"toString":{"utilization":1}}');
    let deep: unknown = { used_percent: 1, limit_window_seconds: 5 };
    for (let i = 0; i < 20; i++)
      deep = { child: deep };
    for (const provider of ['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama', 'zai', 'future'] as const)
      for (const raw of [special, deep, { value: 'x'.repeat(65536) }])
        for (const fetchedAt of [null, 'bad'])
          expect(() => scanUsageSeries(provider as 'claude', raw, { fetchedAt, rawRedacted: [] })).not.toThrow();
  });
  it('When every window fails Then skipped distinguishes it from genuine disappearance', () => {
    const cases = [['claude', { five_hour: { utilization: 'bad' } }], ['codex', { x: { limit_window_seconds: 100, used_percent: 'bad' } }], ['antigravity', { groups: [{ buckets: [{ remainingFraction: 'bad' }] }] }], ['opencode', { usage: { weekly: { percent: 'bad' } } }], ['grok', { config: { creditUsagePercent: 'bad' } }], ['ollama', { included: { allowance_usd: 0, balance_usd: 3 } }], ['zai', { data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 'bad' }] } }]] as const;
    for (const [provider, raw] of cases)
      expect(scanUsageSeries(provider, raw, options)).toMatchObject({ ok: true, series: [], skipped: 1 });
  });
  it('When redaction uses bracket and dotted forms Then the entire series subtree is excluded', () => {
    const raw = { additional_rate_limits: [{ used_percent: 3, limit_window_seconds: 100 }] };
    for (const path of ['additional_rate_limits', 'additional_rate_limits.0', 'additional_rate_limits[0]'])
      expect(scanUsageSeries('codex', raw, { ...options, rawRedacted: [path] })).toEqual({ ok: true, series: [], skipped: 0 });
  });
});

describe('Given a redacted malformed limit', () => {
  it('When a hidden limit cannot be parsed Then it is excluded rather than counted as skipped', () => {
    expect(scanUsageSeries('claude', {five_hour:{utilization:'bad'}}, {...options,rawRedacted:['five_hour']})).toEqual({ok:true,series:[],skipped:0})
    expect(scanUsageSeries('codex', {x:{limit_window_seconds:100,used_percent:'bad'}}, {...options,rawRedacted:['x']})).toEqual({ok:true,series:[],skipped:0})
  })
})

describe('Given Z.AI Coding Plan limits', () => {
  const limit = (unit: number, number: number, percentage: unknown, extra: Record<string, unknown> = {}) => ({ type: 'CREDIT_LIMIT', unit, number, percentage, nextResetTime: 1795261405338, ...extra });
  it('When both known windows are present Then the 5-hour series leads the weekly one with ms epoch resets as ISO', () => {
    const raw = { data: { limits: [limit(6, 1, 15, { nextResetTime: 1795847817983 }), limit(3, 5, 20)], level: 'pro' } };
    expect(scanUsageSeries('zai', raw, options)).toEqual({ ok: true, skipped: 0, series: [
      { id: 'five_hour', usedPercent: 20, resetsAt: '2026-11-21T11:43:25.338Z', cycleSeconds: 18000 },
      { id: 'weekly', usedPercent: 15, resetsAt: '2026-11-28T06:36:57.983Z', cycleSeconds: 604800 },
    ] });
  });
  it('When a limit has an unknown type or unit Then it is neither a series nor skipped', () => {
    const raw = { data: { limits: [{ ...limit(5, 1, 1), type: 'TIME_LIMIT' }, limit(5, 1, 2), limit(3, 5, 7)] } };
    expect(scanUsageSeries('zai', raw, options)).toMatchObject({ ok: true, skipped: 0, series: [{ id: 'five_hour', usedPercent: 7 }] });
  });
  it('When limits is an empty array Then zero series is a successful complete scan', () => {
    expect(scanUsageSeries('zai', { data: { limits: [] } }, options)).toEqual({ ok: true, series: [], skipped: 0 });
  });
  it('When data or limits is missing Then shape failure is explicit', () => {
    for (const raw of [{ code: 401, success: false }, { data: null }, { data: {} }, { data: { limits: {} } }])
      expect(scanUsageSeries('zai', raw, options)).toEqual({ ok: false, reason: 'invalid_shape' });
  });
  it('When a window reset before the fetch Then the expired series is dropped', () => {
    const raw = { data: { limits: [limit(3, 5, 20), limit(6, 1, 15, { nextResetTime: 1795847817983 })] } };
    expect(scanUsageSeries('zai', raw, { ...options, fetchedAt: '2026-11-21T12:00:00.000Z' })).toMatchObject({ ok: true, skipped: 0, series: [{ id: 'weekly' }] });
  });
  it('When a limit path or series id is redacted Then it is excluded rather than counted as skipped', () => {
    const raw = { data: { limits: [limit(3, 5, 'bad'), limit(6, 1, 15)] } };
    for (const path of ['data', 'data.limits', 'data.limits[0]', 'data.limits.0'])
      expect(scanUsageSeries('zai', raw, { ...options, rawRedacted: [path] })).toMatchObject({ ok: true, skipped: 0 });
    expect(scanUsageSeries('zai', raw, { ...options, rawRedacted: ['data.limits[1]'] })).toEqual({ ok: true, series: [], skipped: 1 });
    expect(scanUsageSeries('zai', raw, { ...options, rawRedacted: ['weekly'] })).toEqual({ ok: true, series: [], skipped: 1 });
  });
});
