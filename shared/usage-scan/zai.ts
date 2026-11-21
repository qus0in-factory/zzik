import { clampPercent, epochMsOrNull, isRecord } from './parts.ts';
/** Z.AI(GLM Coding Plan) `data.limits[]` 중 읽는 창. unit 3 = 시간, 6 = 주. 표시 순서도 이 표를 따른다. */
const ZAI_WINDOWS = [
  { id: 'five_hour', unit: 3, number: 5, cycleSeconds: 18000 },
  { id: 'weekly', unit: 6, number: 1, cycleSeconds: 604800 },
] as const;
export interface ZaiWindow {
  id: string;
  usedPercent: number;
  resetsAt: string | null;
  cycleSeconds: number;
  /** `data.limits` 안의 원본 위치(가림 경로·문제 보고용). */
  index: number;
}
/**
 * `CREDIT_LIMIT`이면서 표에 있는 unit·number 조합만 읽는다. 그 밖의 type·조합(TIME_LIMIT 등)은 문제로 세지 않고 지나친다.
 * 같은 창이 두 번 오면 먼저 읽힌 쪽을 쓴다. `invalid`는 아는 창인데 percentage를 못 읽은 항목의 위치다.
 */
export function readZaiLimits(limits: readonly unknown[]): { windows: ZaiWindow[]; invalid: number[] } {
  const found = new Map<string, ZaiWindow>(), invalid: number[] = [];
  limits.forEach((entry, index) => {
    if (!isRecord(entry) || entry.type !== 'CREDIT_LIMIT')
      return;
    const known = ZAI_WINDOWS.find(w => w.unit === entry.unit && w.number === entry.number);
    if (known === undefined || found.has(known.id))
      return;
    const usedPercent = clampPercent(entry.percentage);
    if (usedPercent === null) {
      invalid.push(index);
      return;
    }
    found.set(known.id, { id: known.id, usedPercent, resetsAt: epochMsOrNull(entry.nextResetTime), cycleSeconds: known.cycleSeconds, index });
  });
  return { windows: ZAI_WINDOWS.flatMap(w => found.get(w.id) ?? []), invalid };
}
/** `data.limits`가 배열일 때만 돌려준다(없으면 형상 오류). */
export function zaiLimits(raw: Record<string, unknown>): unknown[] | null {
  return isRecord(raw.data) && Array.isArray(raw.data.limits) ? raw.data.limits : null;
}
