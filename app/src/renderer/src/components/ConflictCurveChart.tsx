import { useMemo } from 'react'
import { getConflictCurve } from '@shared/codexLogic'
import { useAtlasStore } from '../state/store'

const WIDTH = 960
const HEIGHT = 280
const PAD_L = 32
const PAD_R = 16
const PAD_T = 16
const PAD_B = 36
const PLOT_W = WIDTH - PAD_L - PAD_R
const PLOT_H = HEIGHT - PAD_T - PAD_B
const LEVELS = [1, 2, 3, 4, 5]

function yFor(level: number): number {
  return PAD_T + PLOT_H - ((level - 1) / (LEVELS.length - 1)) * PLOT_H
}

// Hand-rolled SVG line chart — no chart library in this project (see
// Timeline.tsx's CSS-grid timeline for the sibling precedent). x-axis is
// reading-order ordinal from getManuscriptReadingOrder; only scenes with an
// explicitly-set conflictLevel are plotted at all (getConflictCurve already
// filters unset scenes out), so the line connects assessed scenes only and
// never dips to a false zero for a scene that just hasn't been tagged yet.
export function ConflictCurveChart(): JSX.Element {
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const points = useMemo(() => (manuscriptTree ? getConflictCurve(manuscriptTree) : []), [manuscriptTree])

  if (points.length === 0) {
    return (
      <div style={{ color: 'var(--c-ink-soft)', fontSize: 14, lineHeight: 1.6 }}>
        No conflict levels set yet. Open a scene's metadata panel, expand "Story craft," and set a conflict level
        (1–5) to start building the tension curve.
      </div>
    )
  }

  const xStep = points.length > 1 ? PLOT_W / (points.length - 1) : 0
  const xFor = (i: number): number => PAD_L + i * xStep

  const maxPoint = points.reduce((max, p) => (p.conflictLevel > max.conflictLevel ? p : max), points[0])
  const maxIndex = points.indexOf(maxPoint)

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {LEVELS.map((level) => (
          <g key={level}>
            <line x1={PAD_L} x2={WIDTH - PAD_R} y1={yFor(level)} y2={yFor(level)} stroke="var(--c-border)" strokeWidth={1} />
            <text x={PAD_L - 8} y={yFor(level) + 4} textAnchor="end" fontSize={10.5} fill="var(--c-ink-faint)">
              {level}
            </text>
          </g>
        ))}

        <path
          d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.conflictLevel)}`).join(' ')}
          fill="none"
          stroke="var(--c-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <g key={p.sceneId}>
            <circle cx={xFor(i)} cy={yFor(p.conflictLevel)} r={6} fill="var(--c-surface)" />
            <circle cx={xFor(i)} cy={yFor(p.conflictLevel)} r={4} fill="var(--c-accent)">
              <title>{`${p.sceneTitle} — conflict level ${p.conflictLevel}`}</title>
            </circle>
          </g>
        ))}

        {/* Direct labels — sparing, not one per point: first, last, and the peak. */}
        <EndLabel point={points[0]} x={xFor(0)} y={yFor(points[0].conflictLevel)} anchor="start" />
        {points.length > 1 && (
          <EndLabel
            point={points[points.length - 1]}
            x={xFor(points.length - 1)}
            y={yFor(points[points.length - 1].conflictLevel)}
            anchor="end"
          />
        )}
        {maxIndex !== 0 && maxIndex !== points.length - 1 && (
          <EndLabel point={maxPoint} x={xFor(maxIndex)} y={yFor(maxPoint.conflictLevel)} anchor="middle" />
        )}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 2 }}>
        <span>{points[0].sceneTitle}</span>
        <span>Reading order →</span>
        <span>{points[points.length - 1].sceneTitle}</span>
      </div>
    </div>
  )
}

function EndLabel({
  point,
  x,
  y,
  anchor
}: {
  point: { sceneTitle: string; conflictLevel: number }
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}): JSX.Element {
  const dy = y < PAD_T + 20 ? 16 : -12
  return (
    <text x={x} y={y + dy} textAnchor={anchor} fontSize={10.5} fill="var(--c-ink-soft)">
      {point.conflictLevel}
    </text>
  )
}
