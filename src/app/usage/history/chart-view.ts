/**
 * ui ↔ app 경계 타입(ADR 0.7 11절). T0에서는 타입만 동결한다 — 구현은 T3에서 한다.
 * ui는 이 타입의 값만 받아 그리고, 판정·문구·좌표는 app이 만든다.
 * 좌표는 전부 SVG 사용자 단위(px)이고 원점은 SVG 왼쪽 위다.
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

/** 한 계열. 배열 순서는 범례 순서이고 레코드의 seriesOrder 순이다. */
export interface ChartSeriesView {
  /** 계열 id(카드 id). ChartStopValue.seriesId와 같은 값. */
  id: string
  label: string
  /**
   * 색 슬롯. 1~8 = 팔레트(`--chart-1`~`--chart-8`), 0 = 9번째 이후(중립 회색 `--chart-overflow`).
   * seriesOrder의 순번(0부터)이 i일 때 i < 8이면 i + 1, 아니면 0. 숨김·범위·정렬로 바뀌지 않는다.
   */
  slot: number
  /** 기본 테마의 stroke-dasharray. 슬롯 1~3은 null(실선), 4~8과 0은 무늬 문자열. */
  dash: string | null
  /** 숨김이면 paths·dots는 빈 배열, endLabel은 null이고 stops에도 나오지 않는다. */
  hidden: boolean
  /** 구간마다 path의 d 하나. */
  paths: string[]
  /** 점이 하나뿐인 구간. */
  dots: { x: number; y: number }[]
  endLabel: { x: number; y: number; text: string } | null
}

/** 한 시점에서 한 계열의 값. */
export interface ChartStopValue {
  seriesId: string
  /** 그 시각에 유효한 사용률. 100을 넘어도 자르지 않은 실제 값. 틈(값 없음)이면 null. */
  percent: number | null
  /** 표시 문구. `42%`, `104%`, 값이 없으면 `—`. */
  text: string
  /** 십자선 위 표식의 y. percent가 null이면 null. 100을 넘으면 100의 위치. */
  y: number | null
}

/** 십자선이 붙을 수 있는 시점 하나. 툴팁과 range 입력이 이것만으로 그려진다. */
export interface ChartStop {
  /** epoch ms. 표본의 fetchedAt, 또는 마지막 원소에 한해 꼬리 끝 시각. */
  t: number
  /** 십자선의 x. plot 안쪽. */
  x: number
  /** 시각 문구(브라우저 현지 시각). 예: `11월 14일 10:15`. */
  label: string
  /** 보이는 계열 전부. percent 내림차순, null은 뒤, 같으면 series 순서. */
  values: ChartStopValue[]
  /** range 입력의 aria-valuetext. 예: `11월 14일 10:15 — 5시간 한도 42%, 주간 한도 18%`. */
  valueText: string
}

export interface ChartView {
  range: ChartRange
  /** SVG 전체 크기(viewBox `0 0 width height`). */
  width: number
  height: number
  /** 선이 그려지는 영역. 격자선은 x~x+width, 십자선은 y~y+height, 적중 영역도 이 사각형. */
  plot: { x: number; y: number; width: number; height: number }
  /** SVG <title>. 예: `Claude 사용률 추이 · 최근 7일`. */
  title: string
  /** SVG <desc>. 기간, 계열 수, 보이는 계열별 현재 값·기간 최고. */
  description: string
  xTicks: { x: number; label: string }[]
  yTicks: { y: number; label: string }[]
  /** 범위 안에 값이 있는 계열 전부(숨긴 것 포함). */
  series: ChartSeriesView[]
  /** x 오름차순(같은 x 없음). 표본 시각 그대로이고 솎지 않는다. 최대 4,001개. 그릴 것이 없으면 빈 배열. */
  stops: ChartStop[]
  table: { id: string; label: string; current: string; peak: string; low: string; resets: number }[]
  empty: 'none' | 'no_points' | 'all_hidden'
}

export type ChartPanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; view: ChartView; syncing: boolean; progress: string | null; note: string | null }

/** 패널의 조작. 뷰(ChartView)와 상태(ChartPanelState)에 넣지 않는다 — 데이터가 바뀌어도 참조가 유지돼야 한다. */
export interface ChartPanelActions {
  onSelectRange(range: ChartRange): void
  /** 그 계열의 표시 여부를 뒤집는다. 슬롯 0 계열도 같은 콜백을 쓴다. */
  onToggleSeries(seriesId: string): void
  /** 슬롯 1~8의 숨김을 모두 푼다. 슬롯 0 계열의 상태는 바꾸지 않는다. */
  onShowAllSeries(): void
  /** phase가 'error'일 때의 다시 시도. */
  onRetry(): void
  /** ui가 잰 SVG 크기를 알린다. app은 이 크기로 ChartView를 다시 만든다. */
  onResize(size: { width: number; height: number }): void
}

/** `UsageHistoryPanel`의 프롭 전부. */
export interface UsageHistoryPanelProps {
  /** ChartButtonState.panelId와 같은 값(aria-controls의 대상 id). */
  panelId: string
  /** region의 aria-label. 예: `Claude 사용률 추이`. */
  regionLabel: string
  /** 선택된 범위. phase가 'loading'·'error'여도 탭을 그릴 수 있게 view 밖에 둔다. */
  range: ChartRange
  state: ChartPanelState
  actions: ChartPanelActions
}

/** `useUsageHistoryPanel(provider)`의 반환. panel이 null이면 닫힌 상태(패널을 렌더하지 않는다). */
export interface UsageHistoryPanelBinding {
  button: ChartButtonState
  panel: UsageHistoryPanelProps | null
}
