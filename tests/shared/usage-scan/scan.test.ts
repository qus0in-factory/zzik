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
  it.each(['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama'] as const)('When %s receives nonobjects Then shape failure is not an empty successful scan', provider => {
    for (const raw of [null, undefined, 1, 'x', []])
      expect(scanUsageSeries(provider, raw, options)).toEqual({ ok: false, reason: 'invalid_shape' });
  });
  it('When window structures are missing Then shape failure is explicit', () => {
    for (const provider of ['antigravity', 'grok', 'opencode'] as const)
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
    for (const provider of ['claude', 'codex', 'antigravity', 'opencode', 'grok', 'ollama', 'future'] as const)
      for (const raw of [special, deep, { value: 'x'.repeat(65536) }])
        for (const fetchedAt of [null, 'bad'])
          expect(() => scanUsageSeries(provider as 'claude', raw, { fetchedAt, rawRedacted: [] })).not.toThrow();
  });
  it('When every window fails Then skipped distinguishes it from genuine disappearance', () => {
    const cases = [['claude', { five_hour: { utilization: 'bad' } }], ['codex', { x: { limit_window_seconds: 100, used_percent: 'bad' } }], ['antigravity', { groups: [{ buckets: [{ remainingFraction: 'bad' }] }] }], ['opencode', { usage: { weekly: { percent: 'bad' } } }], ['grok', { config: { creditUsagePercent: 'bad' } }], ['ollama', { included: { allowance_usd: 0, balance_usd: 3 } }]] as const;
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
