import type { OffpeakSchedule } from './offpeak'

/** UTC 고정, 종료일 없음. 중국 공휴일은 반영하지 않는다. */
export const OFFPEAK_SCHEDULE: OffpeakSchedule = {
  opencode: {
    windows: [
      { start: '00:00', end: '01:00', days: [1, 2, 3, 4, 5] },
      { start: '04:00', end: '06:00', days: [1, 2, 3, 4, 5] },
      { start: '10:00', end: '24:00', days: [1, 2, 3, 4, 5] },
      { start: '00:00', end: '24:00', days: [0, 6] },
    ],
    source: 'https://opencode.ai/docs/console/go/#usage-limits',
    verifiedAt: '2026-11-15',
    effect: { target: 'DeepSeek', discountPercent: 50 },
  },
  ollama: {
    windows: [
      { start: '00:00', end: '12:00', days: [1, 2, 3, 4, 5] },
      { start: '18:00', end: '24:00', days: [1, 2, 3, 4, 5] },
      { start: '00:00', end: '24:00', days: [0, 6] },
    ],
    source: 'https://ollama.com/pricing',
    verifiedAt: '2026-11-15',
    effect: { target: 'DeepSeek', discountPercent: 50 },
  },
}
