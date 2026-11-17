import { t } from '@shared/messages'
import type { TrendMetricsEntry } from '@shared/trend-contract'

/** --brand(#057873) 계열의 5단계 명도. 0~2는 흰 글자, 3~4는 검정 글자로 4.5:1 이상이다. */
export const TREEMAP_STEPS = [
  { background: '#024a46', foreground: '#ffffff' },
  { background: '#035c58', foreground: '#ffffff' },
  { background: '#057873', foreground: '#ffffff' },
  { background: '#4fa8a2', foreground: '#0a0a0a' },
  { background: '#9fd4d0', foreground: '#0a0a0a' },
] as const

/** Treemap(nodeGap)이 칸 사이에 비우는 간격(px). 컨테이너 배경이 틈으로 보인다. */
export const TREEMAP_GAP = 2

export type TreemapLabelStage = 'full' | 'compact' | 'share' | 'none'

export interface TreemapTooltipData {
  /** 날짜 접미를 떼지 않은 원본 id. */
  fullName: string
  /** 칸에 보이는 이름(날짜 접미 제거). */
  displayName: string
  creator: string | null
  rank: number
  shareText: string
  deltaText: string | null
}

export interface TreemapCellData extends TreemapTooltipData {
  [key: string]: unknown
  id: string
  /** Recharts의 dataKey. 점유율 그대로 쓴다. */
  size: number
  /** 칸 안에 그리는 짧은 퍼센트(예: 28.8%). */
  sharePercent: string
  compactName: string
  ariaLabel: string
  step: number | 'other'
  tone: 'dark' | 'light' | 'other'
  fill: string
  textColor: string
}

const DATE_SUFFIX = /-\d{8}$/

/** 운영 모델 id의 날짜 접미(`-20261017`)를 표시 이름에서 뗀다. */
export function stripDateSuffix(name: string): string {
  return name.replace(DATE_SUFFIX, '')
}

/** other는 '기타', 나머지는 날짜 접미를 뗀 이름. */
export function displayModelName(entry: Pick<TrendMetricsEntry, 'id' | 'name'>): string {
  return entry.id === 'other' ? t('trend.metrics.treemap.other') : stripDateSuffix(entry.name)
}

/** 칸이 좁을 때 쓰는 축약 이름: creator 경로를 떼고 마지막 조각만 남긴다. */
export function compactModelName(entry: Pick<TrendMetricsEntry, 'id' | 'name'>): string {
  if (entry.id === 'other') return t('trend.metrics.treemap.other')
  const base = stripDateSuffix(entry.name)
  const slash = base.lastIndexOf('/')
  const tail = slash >= 0 ? base.slice(slash + 1) : base
  return tail.length <= 20 ? tail : `${tail.slice(0, 19)}…`
}

/** 점유율을 최대값 대비 5단계 명도로 매핑한다. 작은 점유율일수록 밝다. */
export function treemapStep(value: number, maxValue: number): number {
  if (maxValue <= 0) return TREEMAP_STEPS.length - 1
  const ratio = value / maxValue
  if (ratio >= 0.65) return 0
  if (ratio >= 0.35) return 1
  if (ratio >= 0.18) return 2
  if (ratio >= 0.07) return 3
  return 4
}

/**
 * 칸 크기(px)에 따라 라벨을 단계적으로 줄인다.
 * full(이름+점유율+변동) → compact(축약 이름+점유율) → share(점유율만) → none(툴팁·aria만).
 */
export function treemapLabelStage(width: number, height: number): TreemapLabelStage {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'none'
  if (width >= 100 && height >= 40) return 'full'
  if (width >= 64 && height >= 28) return 'compact'
  if (width >= 28 && height >= 16) return 'share'
  // 폭이 좁고 세로로 긴 칸은 점유율을 세로쓰기로 보여 준다.
  if (width >= 12 && height >= 36) return 'share'
  return 'none'
}

function charWidth(char: string, fontSize: number): number {
  // 한글·전각은 1em, 라틴 문자는 대략 0.6em로 잡는다.
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(char) ? fontSize : fontSize * 0.6
}

/** 칸 폭 안에 들어가도록 글자를 자르고 말줄임표를 붙인다. */
export function truncateLabel(text: string, maxWidth: number, fontSize: number): string {
  if (maxWidth <= 0) return ''
  let used = 0
  let end = 0
  for (const char of text) {
    const next = used + charWidth(char, fontSize)
    if (next > maxWidth) break
    used = next
    end += char.length
  }
  if (end >= text.length) return text
  const ellipsisWidth = charWidth('…', fontSize)
  while (end > 0 && used + ellipsisWidth > maxWidth) {
    const char = [...text.slice(0, end)].at(-1) ?? ''
    used -= charWidth(char, fontSize)
    end -= char.length
  }
  return `${text.slice(0, end)}…`
}

function percentText(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

function deltaText(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined || Math.abs(delta) < 0.0005) return null
  const value = (Math.abs(delta) * 100).toFixed(1)
  return delta > 0 ? t('trend.metrics.treemap.up', { value }) : t('trend.metrics.treemap.down', { value })
}

/** 툴팁·aria에 쓰는 전체 id와 점유율·변동. */
export function treemapTooltip(entry: TrendMetricsEntry): TreemapTooltipData {
  const share = (entry.share7d ?? 0) * 100
  return {
    fullName: entry.id === 'other' ? t('trend.metrics.treemap.other') : entry.name,
    displayName: displayModelName(entry),
    creator: entry.creator,
    rank: entry.rank,
    shareText: t('trend.metrics.or.share', { share: share.toFixed(1) }),
    deltaText: deltaText(entry.shareDelta),
  }
}

/** 칸의 접근 가능한 이름. 같은 이름의 모델이 있어도 전체 id로 구분한다. */
export function treemapCellAriaLabel(entry: TrendMetricsEntry): string {
  const tooltip = treemapTooltip(entry)
  return tooltip.deltaText === null
    ? `${tooltip.fullName} ${tooltip.shareText}`
    : `${tooltip.fullName} ${tooltip.shareText} ${tooltip.deltaText}`
}

/** 점유율이 있는 항목만 큰 순서로 셀로 만든다. other는 회색. */
export function buildTreemapCells(entries: readonly TrendMetricsEntry[]): TreemapCellData[] {
  const positive = entries.filter((entry) => (entry.share7d ?? 0) > 0)
  const maxShare = positive.reduce((max, entry) => Math.max(max, entry.share7d ?? 0), 0)
  return positive
    .slice()
    .sort((a, b) => (b.share7d ?? 0) - (a.share7d ?? 0) || a.rank - b.rank || a.id.localeCompare(b.id))
    .map((entry) => {
      const tooltip = treemapTooltip(entry)
      const share = entry.share7d ?? 0
      const isOther = entry.id === 'other'
      const step = treemapStep(share, maxShare)
      const palette = TREEMAP_STEPS[step]!
      return {
        ...tooltip,
        id: entry.id,
        size: share,
        sharePercent: percentText(share),
        compactName: compactModelName(entry),
        ariaLabel: treemapCellAriaLabel(entry),
        step: isOther ? 'other' : step,
        tone: isOther ? 'other' : step >= 3 ? 'light' : 'dark',
        fill: isOther ? 'var(--muted)' : palette.background,
        textColor: isOther ? 'var(--muted-foreground)' : palette.foreground,
      }
    })
}

/** 칸 안에 그릴 줄과 단계. SVG 텍스트 배치와 테스트가 같은 규칙을 쓴다. */
export function treemapCellLabel(
  cell: Pick<TreemapCellData, 'displayName' | 'compactName' | 'sharePercent' | 'deltaText'>,
  width: number,
  height: number,
): { stage: TreemapLabelStage; lines: string[]; fontSize: number; rotate: boolean } {
  const stage = treemapLabelStage(width, height)
  if (stage === 'full') {
    const lines = [truncateLabel(cell.displayName, width - 16, 11), cell.sharePercent]
    if (cell.deltaText !== null && height >= 58) lines.push(cell.deltaText)
    return { stage, lines, fontSize: 11, rotate: false }
  }
  if (stage === 'compact') {
    return { stage, lines: [truncateLabel(cell.compactName, width - 12, 10), cell.sharePercent], fontSize: 10, rotate: false }
  }
  if (stage === 'share') {
    return { stage, lines: [cell.sharePercent], fontSize: width < 28 ? 9 : 10, rotate: width < 28 }
  }
  return { stage, lines: [], fontSize: 10, rotate: false }
}
