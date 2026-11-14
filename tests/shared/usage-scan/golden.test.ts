import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scanUsageSeries } from '../../../shared/usage-scan/index.ts';
import { USAGE_HISTORY_SCAN_VERSION } from '../../../shared/usage-history-contract';
import type { UsageProvider } from '../../../shared/usage-contract';
describe('Given the frozen scan version', () => {
  it('When any fixture semantics change Then the versioned golden must change through the contract gate', () => {
    const dir = new URL('../../fixtures/', import.meta.url), actual: Record<string, unknown> = {};
    for (const name of readdirSync(dir).filter(n => /^(claude|codex|antigravity|opencode|grok|ollama)-(?:usage|cli-quota).*\.json$/.test(n)).sort())
      actual[name] = scanUsageSeries(name.split('-')[0] as UsageProvider, JSON.parse(readFileSync(new URL(name, dir), 'utf8')), { fetchedAt: '2026-11-11T12:00:00.000Z', rawRedacted: [] });
    expect(actual).toEqual(JSON.parse(readFileSync(new URL(`../../fixtures/usage-scan/golden.v${USAGE_HISTORY_SCAN_VERSION}.json`, import.meta.url), 'utf8')));
  });
});
