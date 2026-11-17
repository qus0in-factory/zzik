import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Treemap } from 'recharts'
import type { TreemapNode } from 'recharts'
import { t } from '@shared/messages'
import {
  TREEMAP_GAP,
  treemapCellLabel,
  type TreemapCellData,
  type TreemapTooltipData,
} from './treemap-data'

interface ActiveCell {
  cell: TreemapCellData
  x: number
  y: number
  width: number
  height: number
}

interface CellProps {
  cell: TreemapCellData
  node: TreemapNode
  active: boolean
  onHover: (active: ActiveCell | null) => void
  onFocus: (active: ActiveCell) => void
  onBlur: (cell: TreemapCellData) => void
  onSelect: (active: ActiveCell) => void
}

function toActive(cell: TreemapCellData, node: TreemapNode): ActiveCell {
  return { cell, x: node.x, y: node.y, width: node.width, height: node.height }
}

function TreemapCell({ cell, node, active, onHover, onFocus, onBlur, onSelect }: CellProps): ReactElement {
  const clipId = `treemap-cell-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const label = treemapCellLabel(cell, node.width, node.height)
  const padding = label.stage === 'full' ? 8 : 6
  const lineHeight = label.stage === 'full' ? 13 : 12
  const centerX = node.x + node.width / 2
  const centerY = node.y + node.height / 2
  const firstLineY = label.stage === 'none' ? node.y : node.y + padding + label.fontSize
  return (
    <g
      data-testid="trend-treemap-cell"
      data-entry-id={cell.id}
      data-stage={label.stage}
      data-step={cell.step}
      data-tone={cell.tone}
      role="listitem"
      tabIndex={0}
      aria-label={cell.ariaLabel}
      className="outline-none"
      onMouseEnter={() => onHover(toActive(cell, node))}
      onFocus={() => onFocus(toActive(cell, node))}
      onBlur={() => onBlur(cell)}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(toActive(cell, node))
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={2} />
        </clipPath>
      </defs>
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={2}
        fill={cell.fill}
        stroke={active ? 'var(--ring)' : 'transparent'}
        strokeWidth={active ? 2 : 0}
      />
      {label.lines.length > 0 && (
        <g clipPath={`url(#${clipId})`} pointerEvents="none">
          {label.rotate ? (
            <text
              x={centerX}
              y={centerY}
              transform={`rotate(-90 ${centerX} ${centerY})`}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={cell.textColor}
              fontSize={label.fontSize}
              className="tabular-nums"
            >
              {label.lines[0]}
            </text>
          ) : label.stage === 'share' ? (
            <text
              x={centerX}
              y={centerY + label.fontSize / 3}
              textAnchor="middle"
              fill={cell.textColor}
              fontSize={label.fontSize}
              className="tabular-nums"
            >
              {label.lines[0]}
            </text>
          ) : (
            label.lines.map((line, index) => (
              <text
                key={`${cell.id}-${index}`}
                x={node.x + padding}
                y={firstLineY + index * lineHeight}
                fill={cell.textColor}
                fontSize={label.fontSize}
                fontWeight={index === 0 ? 600 : 400}
                className="tabular-nums"
              >
                {line}
              </text>
            ))
          )}
        </g>
      )}
    </g>
  )
}

/** 툴팁 내용. 라이브러리 없이 렌더·테스트할 수 있게 HTML로 분리했다. */
export function TreemapTooltipCard({ data }: { data: TreemapTooltipData }): ReactNode {
  return (
    <div
      role="tooltip"
      data-testid="trend-treemap-tooltip"
      className="pointer-events-none w-max max-w-full rounded-md border border-border bg-card px-2.5 py-2 text-xs text-card-foreground shadow-md"
    >
      <p className="font-medium">{data.displayName}</p>
      {data.fullName !== data.displayName && (
        <p className="mt-1 break-all text-[11px] text-muted-foreground">
          {t('trend.metrics.treemap.fullId')} {data.fullName}
        </p>
      )}
      <p className="mt-1 tabular-nums">{data.shareText}</p>
      {data.deltaText !== null && <p className="tabular-nums">{data.deltaText}</p>}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t('trend.metrics.treemap.rank', { rank: data.rank })}
        {data.creator !== null && ` · ${data.creator}`}
      </p>
    </div>
  )
}

/**
 * Recharts Treemap으로 점유율 트리맵을 그린다. /trend에서만 lazy 로드한다.
 * 작은 칸은 라벨을 단계적으로 줄이고, 호버·포커스·탭 시 HTML 툴팁으로 전체 정보를 보여 준다.
 */
export default function TreemapChart({ cells }: { cells: readonly TreemapCellData[] }): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [active, setActive] = useState<ActiveCell | null>(null)
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const byId = new Map(cells.map((cell) => [cell.id, cell]))

  useLayoutEffect(() => {
    const element = containerRef.current
    if (element === null) return
    const update = (): void => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // jsdom/초기 렌더처럼 측정 전이면 고정 크기로 그려 빈 화면을 피한다.
  const width = size.width > 0 ? Math.floor(size.width) : 720
  const height = size.height > 0 ? Math.floor(size.height) : 320
  const tooltipHalfWidth = Math.min(120, Math.max(width / 2 - 4, 1))
  const tooltipHalfHeight = Math.min(60, Math.max(height / 2 - 4, 1))
  const tooltipLeft = active === null ? 0 : Math.min(Math.max(active.x + active.width / 2, tooltipHalfWidth), Math.max(width - tooltipHalfWidth, tooltipHalfWidth))
  const tooltipTop = active === null ? 0 : Math.min(Math.max(active.y + active.height / 2, tooltipHalfHeight), Math.max(height - tooltipHalfHeight, tooltipHalfHeight))

  return (
    <div
      ref={containerRef}
      data-testid="trend-treemap-chart"
      className="relative h-full w-full"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        setPinnedId(null)
        setActive(null)
      }}
      onClick={() => {
        setPinnedId(null)
        setActive(null)
      }}
    >
      <Treemap
        width={width}
        height={height}
        data={cells as TreemapCellData[]}
        dataKey="size"
        nameKey="displayName"
        aspectRatio={1.6}
        nodeGap={TREEMAP_GAP}
        isAnimationActive={false}
        onMouseEnter={(node) => {
          if (pinnedId !== null) return
          const cell = byId.get(String(node.id))
          if (cell !== undefined) setActive(toActive(cell, node))
        }}
        onMouseLeave={(node) => {
          if (pinnedId !== null) return
          const cell = byId.get(String(node.id))
          if (cell !== undefined) setActive((current) => (current?.cell.id === cell.id ? null : current))
        }}
        content={(node) => {
          const cell = byId.get(String(node.id))
          if (cell === undefined) return <g />
          return (
            <TreemapCell
              cell={cell}
              node={node}
              active={active?.cell.id === cell.id}
              onHover={(next) => {
                if (pinnedId === null) setActive(next)
              }}
              onFocus={(next) => setActive(next)}
              onBlur={(cellData) => {
                if (pinnedId !== cellData.id) setActive(null)
              }}
              onSelect={(next) => {
                if (pinnedId === next.cell.id) {
                  setPinnedId(null)
                  setActive(null)
                } else {
                  setPinnedId(next.cell.id)
                  setActive(next)
                }
              }}
            />
          )
        }}
      />
      {active !== null && (
        <div
          className="absolute z-10"
          style={{ left: tooltipLeft, top: tooltipTop, transform: 'translate(-50%, -50%)', maxWidth: Math.max(120, width - 16) }}
        >
          <TreemapTooltipCard data={active.cell} />
        </div>
      )}
    </div>
  )
}
