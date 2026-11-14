/** 한도 표시 방식: 카드(2열) 또는 목록(테이블 행). 전역 설정 하나(제공자별 아님). */
export type ViewMode = 'grid' | 'list'
export const VIEW_MODES: readonly ViewMode[] = ['grid', 'list']
export const DEFAULT_VIEW_MODE: ViewMode = 'grid'

/** 저장된 값(어떤 모양이든)을 ViewMode로 정규화한다. 모르는 값은 기본(카드). */
export function normalizeViewMode(value: unknown): ViewMode {
  return value === 'list' || value === 'grid' ? value : DEFAULT_VIEW_MODE
}

/** 보기 방식 저장 포트(구현은 infra: 브라우저 localStorage). load는 저장된 값을 검증 없이 돌려준다. */
export interface ViewModePort {
  load(): unknown
  save(mode: ViewMode): void
}
