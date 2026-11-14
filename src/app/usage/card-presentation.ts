import { barLevelOf, BAR_LEVEL_TEXT } from '@domain/usage/bar-level'
import type { BarLevel } from '@domain/usage/bar-level'

/** sleeping: 0%·값 없음(막대 시작점에서 잠). idle: 막대 끝에 정지 자세. running: 최근 5분 내 변화가 있어 달리는 중. */
export interface GerbilState {
  mode: 'sleeping' | 'idle' | 'running'
  lapSeconds: number | null
}

export function gerbilStateOf(usedPercent: number | null, lapSeconds: number | null): GerbilState {
  if (usedPercent === null || !Number.isFinite(usedPercent) || usedPercent <= 0) return { mode: 'sleeping', lapSeconds: null }
  if (lapSeconds !== null) return { mode: 'running', lapSeconds }
  return { mode: 'idle', lapSeconds: null }
}

export interface CardPresentation {
  barLevel: BarLevel
  barLevelText: string
  gerbil: GerbilState
}

/** 카드가 그릴 판정 결과. ui는 이 값을 색·자세로만 옮긴다. */
export function cardPresentation(item: { usedPercent: number | null; elapsedPercent?: number | null }, lapSeconds: number | null): CardPresentation {
  const barLevel = barLevelOf(item.usedPercent, item.elapsedPercent)
  return { barLevel, barLevelText: BAR_LEVEL_TEXT[barLevel], gerbil: gerbilStateOf(item.usedPercent, lapSeconds) }
}
