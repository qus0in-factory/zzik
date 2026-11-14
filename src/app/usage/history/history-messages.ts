/**
 * 이력 계층의 사용자 문구를 한 파일에 모은 곳(ADR 0.7). #53(`shared/messages`) 병합 뒤 이 객체의 값을 `t('키')`로 옮기면 된다 —
 * 이 데이터 계층의 한글 문자열 리터럴은 여기에만 있다(다른 history 파일에는 없다).
 */
import type { ChartRange } from '@domain/usage/history/types'

export const historyMessages = {
  // 차트 버튼(8.2절)
  open: '차트 보기',
  close: '차트 닫기',
  // 사유(10절)
  hintNoData: '아직 기록된 이력이 없습니다',
  hintTooFew: (min: number, count: number): string => `변화 기록이 ${min}건 이상 쌓이면 볼 수 있습니다 (현재 ${count}건)`,
  hintTooShort: (hours: number): string => `첫 기록 후 6시간이 지나면 볼 수 있습니다 (약 ${hours}시간 남음)`,
  hintUnknown: '이력 상태를 확인하지 못했습니다',
  // 패널
  regionLabel: (providerTitle: string): string => `${providerTitle} 사용률 추이`,
  progress: (range: ChartRange, done: number, total: number): string => `${historyMessages.range[range]} 이력 불러오는 중 (${done}/${total}일)`,
  range: { '24h': '24시간', '7d': '7일', '30d': '30일' } satisfies Record<ChartRange, string>,
  loadFailed: '이력을 불러오지 못했습니다.',
  chartTitle: (providerTitle: string, range: ChartRange): string => `${providerTitle} 사용률 추이 · 최근 ${historyMessages.range[range]}`,
  emptyDescription: (providerTitle: string): string => `${providerTitle} 사용률 추이: 표시할 이력이 없습니다.`,
  // 오류 코드 문구(USAGE_ERROR_CODE_TEXT에 합쳐진다, 4.2절)
  errors: {
    invalid_query: '이력 요청 형식이 올바르지 않습니다. 페이지를 새로 고친 뒤 다시 시도해 주세요.',
    scan_version_mismatch: '새 버전이 배포되었습니다. 페이지를 새로 고치면 최신 이력을 볼 수 있습니다.',
    history_budget: '이력 요청이 너무 많아 잠시 멈췄습니다. 잠시 후 다시 시도해 주세요.',
    history_conflict: '다른 탭과 이력을 동시에 갱신하고 있습니다. 잠시 후 다시 시도해 주세요.',
  },
} as const
