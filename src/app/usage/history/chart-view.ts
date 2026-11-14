/**
 * ui ↔ app 경계 타입(ADR 0.7 11절). T0에서는 타입만 동결한다 — 구현은 T3에서 한다.
 * ui는 이 타입의 값만 받아 그리고, 판정·문구는 app이 만든다.
 */
import type { ChartRange } from '@domain/usage/history/types'

/** 상태 줄의 차트 버튼 상태. 비활성은 숨기지 않고 사유(hint)를 연결한다. */
export interface ChartButtonState {
  label: '차트 보기' | '차트 닫기'
  expanded: boolean
  disabled: boolean
  hint: string | null
  panelId: string
  onToggle(): void
  onIntent(): void
}

export interface ChartView {
  range: ChartRange
  width: number
  height: number
  xTicks: { x: number; label: string }[]
  yTicks: { y: number; label: string }[]
  series: {
    id: string
    label: string
    slot: number
    dash: string | null
    hidden: boolean
    paths: string[]
    dots: { x: number; y: number }[]
    endLabel: { x: number; y: number; text: string } | null
  }[]
  table: { id: string; label: string; current: string; peak: string; low: string; resets: number }[]
  empty: 'none' | 'no_points' | 'all_hidden'
  description: string
}

export type ChartPanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; view: ChartView; syncing: boolean; progress: string | null; note: string | null }
