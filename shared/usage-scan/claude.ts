import { isRecord } from './parts.ts';
export const WINDOW_IDS: readonly string[] = ['five_hour', 'seven_day'];
export const METRIC_ORDER: readonly string[] = ['seven_day_fable', 'seven_day_opus', 'seven_day_sonnet', 'seven_day_oauth_apps', 'seven_day_cowork', 'extra_usage'];
/** utilization의 값을 해석한다. 없으면 null, 숫자가 아니거나 음수·비유한이면 invalid */
function readUtilization(object: Record<string, unknown>): {
  value: number | null;
  invalid: boolean;
} {
  const raw = object['utilization'];
  if (raw === undefined || raw === null)
    return { value: null, invalid: false };
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0)
    return { value: raw, invalid: false };
  return { value: null, invalid: true };
}
function readResetsAt(object: Record<string, unknown>): string | null {
  const raw = object['resets_at'];
  return typeof raw === 'string' ? raw : null;
}
export interface RawEntryFields {
  utilization: number | null;
  resetsAt: string | null;
  utilizationInvalid: boolean;
}
export function readRawEntry(object: Record<string, unknown>): RawEntryFields {
  const utilization = readUtilization(object);
  return { utilization: utilization.value, resetsAt: readResetsAt(object), utilizationInvalid: utilization.invalid };
}
export function isLimitShape(fields: RawEntryFields): boolean {
  return fields.utilization !== null || fields.resetsAt !== null;
}
export function cycleSeconds(id: string): number | null {
  if (id.startsWith('five_hour'))
    return 5 * 3600;
  if (id.startsWith('seven_day'))
    return 7 * 86400;
  return null;
}
export function scopedLimits(raw: Record<string, unknown>) {
  const result: ({
    key: string;
  } & RawEntryFields)[] = [];
  // Scoped limits are the current API representation; prefer them over legacy keys.
  if (Array.isArray(raw['limits'])) {
    for (const limit of raw['limits']) {
      if (!isRecord(limit) || limit['kind'] !== 'weekly_scoped')
        continue;
      const scope = limit['scope'];
      if (!isRecord(scope))
        continue;
      const model = scope['model'];
      const displayName = isRecord(model) ? model['display_name'] : null;
      const name = typeof displayName === 'string' && displayName.trim()
        ? displayName : scope['surface'];
      if (typeof name !== 'string')
        continue;
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!slug)
        continue;
      const key = 'seven_day_' + slug;
      const fields = readRawEntry({ utilization: limit['percent'], resets_at: limit['resets_at'] });
      result.push({ key, ...fields });
    }
  }
  return result;
}

/** The card classifier and history scan share the decision that a key is a limit. */
export function readClaudeLimit(id: string, value: unknown): (RawEntryFields & {kind: 'window' | 'metric'}) | null {
  const fields = value === null ? {utilization:null,resetsAt:null,utilizationInvalid:false} : isRecord(value) ? readRawEntry(value) : null
  if (fields === null) return null
  if (value !== null && !WINDOW_IDS.includes(id) && !isLimitShape(fields)) return null
  return {...fields,kind:WINDOW_IDS.includes(id)?'window':'metric'}
}
