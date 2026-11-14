import type { UsageProvider } from '../usage-contract.ts';
import type { ScannedSeries, UsageScanResult } from './types.ts';
import { isRecord } from './parts.ts';
import { isRedacted } from './redaction.ts';
import { WINDOW_IDS, METRIC_ORDER, readClaudeLimit, scopedLimits, cycleSeconds } from './claude.ts';
import { readCodexWindows, byWindowLength } from './codex.ts';
import { readAntigravity, antigravityCycleSeconds, hasAntigravityShape, AGY_QUOTA_RAW_SOURCE } from './antigravity.ts';
import { readGrok } from './grok.ts';
import { readOllamaIncluded } from './ollama.ts';
import { opencodeKeys, readOpencodeWindow } from './opencode.ts';
export type { ScannedSeries, UsageScanResult } from './types.ts';
/** Read values only. A poisoned row must never prevent the history cursor advancing. */
export function scanUsageSeries(provider: UsageProvider, raw: unknown, options: {
  fetchedAt: string | null;
  rawRedacted: readonly string[];
}): UsageScanResult {
  try {
    if (!isRecord(raw))
      return { ok: false, reason: 'invalid_shape' };
    const hidden = (path: string) => isRedacted(path, options.rawRedacted);
    let series: ScannedSeries[] = [], skipped = 0;
    if (provider === 'claude') {
      const entries = new Map<string, {
        utilization: number | null;
        resetsAt: string | null;
        utilizationInvalid: boolean;
      }>();
      for (const [id, value] of Object.entries(raw)) {
        if (id === 'limits' || id === 'weekly_scoped_shares' || id === 'extra_usage' || hidden(id))
          continue;
        const limit = readClaudeLimit(id, value);
        if (limit !== null) entries.set(id, limit);
        else if (!isRecord(value) && typeof value !== 'boolean' &&
          (WINDOW_IDS.includes(id) || METRIC_ORDER.includes(id) || /^(five_hour|seven_day)/.test(id))) skipped++;
      }
      for (const f of scopedLimits(raw))
        if (!hidden(f.key)) entries.set(f.key, f);
      const unknown = [...entries.keys()].filter(k => !WINDOW_IDS.includes(k) && !METRIC_ORDER.includes(k)).sort();
      for (const id of [...WINDOW_IDS, ...METRIC_ORDER, ...unknown]) {
        const f = entries.get(id);
        if (!f)
          continue;
        if (f.utilizationInvalid) {
          skipped++;
          continue;
        }
        if (f.utilization !== null)
          series.push({ id, usedPercent: f.utilization, resetsAt: f.resetsAt, cycleSeconds: cycleSeconds(id) });
      }
    }
    else if (provider === 'codex') {
      const scan = readCodexWindows(raw, { fetchedAt: options.fetchedAt });
      skipped = scan.invalidPaths.filter(path => !hidden(path)).length;
      const entries = [...scan.windows.filter(w => w.insideRateLimit).sort(byWindowLength), ...scan.windows.filter(w => !w.insideRateLimit)];
      series = entries.map(w => ({ id: w.path, usedPercent: w.usedPercent, resetsAt: w.resetsAt, cycleSeconds: w.limitWindowSeconds }));
    }
    else if (provider === 'antigravity') {
      if (!hasAntigravityShape(raw))
        return { ok: false, reason: 'invalid_shape' };
      const scan = readAntigravity(raw);
      skipped = scan.problems.filter(p => !hidden(p.path)).length;
      series = scan.buckets.filter(w => !hidden(w.id) && !hidden(raw.source === AGY_QUOTA_RAW_SOURCE ? `rows[${w.bucketIndex}]` : `groups[${w.groupIndex}].buckets[${w.bucketIndex}]`)).sort((a, b) => a.groupIndex - b.groupIndex || (antigravityCycleSeconds(a.window) ?? Infinity) - (antigravityCycleSeconds(b.window) ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(w => ({ id: w.id, usedPercent: w.usedPercent, resetsAt: w.resetsAt, cycleSeconds: antigravityCycleSeconds(w.window) }));
    }
    else if (provider === 'opencode') {
      if (!isRecord(raw.usage))
        return { ok: false, reason: 'invalid_shape' };
      for (const id of opencodeKeys(raw.usage)) {
        if (hidden(id)) continue;
        const entry = raw.usage[id];
        const value = isRecord(entry) ? readOpencodeWindow(id, entry) : null;
        if (value)
          series.push(value);
        else
          skipped++;
      }
    }
    else if (provider === 'grok') {
      if (!isRecord(raw.config))
        return { ok: false, reason: 'invalid_shape' };
      const value = readGrok(raw.config);
      if (value)
        series.push(value);
      else if (!hidden('credits'))
        skipped++;
    }
    else if (provider === 'ollama') {
      const value = isRecord(raw.included) ? readOllamaIncluded(raw.included) : null;
      if (value)
        series.push(value);
      else if (!hidden('included'))
        skipped++;
    }
    else
      return { ok: false, reason: 'invalid_shape' };
    const fetched = options.fetchedAt === null ? NaN : Date.parse(options.fetchedAt);
    return { ok: true, skipped, series: series.filter(w => !isRedacted(w.id, options.rawRedacted) && !(w.resetsAt !== null && Date.parse(w.resetsAt) < fetched)) };
  }
  catch {
    return { ok: false, reason: 'scan_failed' };
  }
}
