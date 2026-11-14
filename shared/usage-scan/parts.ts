export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** 유한한 숫자를 0..100으로 자른다. 숫자가 아니거나 유한하지 않으면 null. 정밀도는 유지한다. */
export function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return null;
  return Math.max(0, Math.min(100, value));
}
/** 해석 가능한 ISO 시각이면 그대로, 아니면 null. */
export function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
/** 두 시각의 간격(초). 둘 다 해석되고 end가 start보다 뒤일 때만. 월 길이를 가정하지 않는다. */
export function secondsBetween(start: unknown, end: unknown): number | null {
  const from = isoOrNull(start);
  const to = isoOrNull(end);
  if (from === null || to === null)
    return null;
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000;
  return seconds > 0 ? seconds : null;
}
export function monthlyCycleSeconds(resetsAt: string | null): number | null {
  if (resetsAt === null)
    return null;
  const end = new Date(resetsAt);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate();
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  start.setUTCDate(Math.min(end.getUTCDate(), last));
  return (end.getTime() - start.getTime()) / 1000;
}
