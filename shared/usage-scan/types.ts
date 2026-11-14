export interface ScannedSeries {
  id: string;
  usedPercent: number;
  resetsAt: string | null;
  cycleSeconds: number | null;
}
export type UsageScanResult = {
  ok: true;
  series: ScannedSeries[];
  skipped: number;
} | {
  ok: false;
  reason: 'invalid_shape' | 'scan_failed';
};
