import { describe, expect, it } from 'vitest';
import { parseHistoryQuery, encodeCursor } from '../../../../worker/domain/usage/history-query';
describe('Given a history query', () => {
  it('When fields are absent Then defaults are frozen', () => expect(parseHistoryQuery(new URLSearchParams())).toEqual({ ok: true, query: { limit: 50 } }));
  it.each(['from=', 'from=2026-02-30T00:00:00Z', 'from=2026-13-01T00:00:00Z', 'from=2026-11-14', 'from=2026-11-14T00:00:00%2B09:00', 'limit=0', 'limit=050', 'limit=1.5', 'limit=101', 'limit=', 'after=2026-11-14T00:00:00Z_12', 'after=2026-11-14T00:00:00.000Z_0', 'after=2026-11-14T00:00:00.000Z', 'after=2026-02-30T00:00:00.000Z_1', 'after=2026-11-14T00:00:00.000Z_9223372036854775808', 'anchor=1', 'until=', 'from=2026-11-14T10:00:00Z&until=2026-11-14T10:00:00Z'])('When %s Then invalid_query', q => expect(parseHistoryQuery(new URLSearchParams(q))).toEqual({ ok: false, reason: 'invalid_query' }));
  it.each(['anchor=0', 'anchor=true', 'anchor=', 'foo=bar', 'from=2026-11-14T00:00:00Z', 'from=2026-11-14T00:00:00.5Z', 'limit=100', 'limit=1&limit=999'])('When %s Then query is accepted', q => expect(parseHistoryQuery(new URLSearchParams(q)).ok).toBe(true));
  it('When generating cursors Then milliseconds and bigint ids are preserved', () => expect(encodeCursor('2026-11-14T00:00:00Z', '9223372036854775807')).toBe('2026-11-14T00:00:00.000Z_9223372036854775807'));
});
