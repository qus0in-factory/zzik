import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts';
import { buildUsageLoadView } from '../../../src/app/usage/load-usage';
import type { UsageProvider } from '../../../shared/usage-contract';
const dir = new URL('../../fixtures/', import.meta.url);
const files = readdirSync(dir).filter(name => /^(claude|codex|antigravity|opencode|grok|ollama)-(?:usage|cli-quota).*\.json$/.test(name));
const fetchedAt = '2026-11-11T12:00:00.000Z';
describe('Given existing provider fixtures', () => {
  it.each(files)('When scanning %s Then series match visible unexpired cards in order', file => {
    const provider = file.split('-')[0] as UsageProvider, raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    const report = buildUsageLoadView({ usage: raw, collection: { schema: 1, provider, status: "ok", called: true, runAt: fetchedAt, fetchedAt, httpStatus: 200, retryAt: null, tokenExpiresAt: null, kvTokenExpiresAt: null, intervalSec: 900, collectorVersion: "test", rawOmitted: null }, rawText: null }, new Date(fetchedAt), provider).report;
    const scan = scanUsageSeries(provider, raw, { fetchedAt, rawRedacted: [] });
    if (report.issues.some(i => i.code === 'invalid_shape')) {
      expect(scan).toEqual({ ok: false, reason: 'invalid_shape' });
      return;
    }
    expect(scan.ok).toBe(true);
    if (!scan.ok)
      return;
    const cards = [...report.windows, ...report.metrics].filter(c => c.usedPercent !== null && !(c.resetsAt !== null && Date.parse(c.resetsAt) < Date.parse(fetchedAt)));
    expect(scan.series.map(s => ({ id: s.id, usedPercent: s.usedPercent, resetsAt: s.resetsAt }))).toEqual(cards.map(c => ({ id: c.id, usedPercent: c.usedPercent, resetsAt: c.resetsAt })));
  });
  it('When every fixture path is replaced with malformed values Then scans never throw', () => {
    const variants: unknown[] = [null, 0, 'x', [], {}];
    const paths = (v: unknown, p: (string | number)[] = []): (string | number)[][] => v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => { const q = [...p, k]; return [q, ...paths(x, q)]; }) : [];
    for (const file of files) {
      const provider = file.split('-')[0] as UsageProvider, raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      for (const path of paths(raw))
        for (const value of variants) {
          const changed = structuredClone(raw);
          let parent = changed;
          for (const k of path.slice(0, -1))
            parent = parent[k];
          parent[path.at(-1)!] = value;
          expect(() => scanUsageSeries(provider, changed, { fetchedAt: null, rawRedacted: [] })).not.toThrow();
        }
    }
  });
});
