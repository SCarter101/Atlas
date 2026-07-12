import { useEffect, useRef, useState } from 'react'
import { SPRINT_PRESET_MINUTES, computeSprintSummary, formatMmSs, remainingMs, type SprintSummary } from '../lib/sprintLogic'
import { countWords } from '../lib/textStats'

type SprintPhase = 'idle' | 'running' | 'summary'

export interface SprintTimerState {
  phase: SprintPhase
  remainingLabel: string
  summary: SprintSummary | null
  start: (minutes: number) => void
  stop: () => void
  dismissSummary: () => void
}

// Sprint timer state lives in this hook, called once and unconditionally
// from ManuscriptWorkspace, rather than inside either of the two
// presentational pieces below. If the state instead lived inside a
// component that gets mounted/unmounted as distraction-free mode toggles
// (a toolbar button vs. a compact pill in the focus-mode chrome — different
// positions in the tree, so React would remount rather than reuse), starting
// a sprint and then entering distraction-free mode would silently reset it —
// which defeats the point of a *focus* sprint. Hoisting the hook keeps one
// instance alive across that toggle.
export function useSprintTimer(prose: string): SprintTimerState {
  const [phase, setPhase] = useState<SprintPhase>('idle')
  const [durationMs, setDurationMs] = useState(0)
  const [startedAtMs, setStartedAtMs] = useState(0)
  const [baselineWords, setBaselineWords] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [summary, setSummary] = useState<SprintSummary | null>(null)

  // A ref (not state) so the ticking interval below doesn't need to restart
  // on every keystroke — only completion needs the *latest* word count, not
  // a re-render on every character typed.
  const proseRef = useRef(prose)
  proseRef.current = prose

  useEffect(() => {
    if (phase !== 'running') return
    const interval = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(interval)
  }, [phase])

  const remaining = phase === 'running' ? remainingMs(startedAtMs, durationMs, now) : 0

  function finish(completedNaturally: boolean): void {
    setSummary(
      computeSprintSummary({
        startedAtMs,
        nowMs: Date.now(),
        durationMs,
        baselineWordCount: baselineWords,
        currentWordCount: countWords(proseRef.current),
        completedNaturally
      })
    )
    setPhase('summary')
  }

  useEffect(() => {
    if (phase === 'running' && remaining <= 0) finish(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, phase])

  function start(minutes: number): void {
    const startedAt = Date.now()
    setDurationMs(minutes * 60000)
    setStartedAtMs(startedAt)
    setBaselineWords(countWords(proseRef.current))
    setNow(startedAt)
    setSummary(null)
    setPhase('running')
  }

  function stop(): void {
    if (phase !== 'running') return
    finish(false)
  }

  function dismissSummary(): void {
    setSummary(null)
    setPhase('idle')
  }

  return { phase, remainingLabel: formatMmSs(remaining), summary, start, stop, dismissSummary }
}

// The toolbar entry point: a pill button (matching ManuscriptWorkspace's
// "Distraction-free" pill) that opens a small panel with the 15/25/45-minute
// presets, a countdown once running, and a quiet completion summary.
//
// Word-count tracking note: on completion this intentionally does NOT call
// window.atlas.sessions.logActivity() itself. main/ipc/handlers.ts's
// scene:write handler already calls logSessionActivity() with the
// word-count delta on every autosaved prose change — so every word written
// during a sprint is already folded into today's session total (and the
// Dashboard momentum card) by the time the sprint ends. Logging the sprint's
// delta again here would double-count it.
export function SprintTimer({ sprint }: { sprint: SprintTimerState }): JSX.Element {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        style={{
          ...pillButtonStyle,
          border: `1px solid ${sprint.phase === 'running' ? 'var(--c-amber)' : 'var(--c-border)'}`,
          color: sprint.phase === 'running' ? 'var(--c-amber)' : 'var(--c-ink-soft)'
        }}
      >
        {sprint.phase === 'running' ? `Sprint · ${sprint.remainingLabel}` : 'Sprint'}
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 34,
            right: 0,
            width: 260,
            background: 'var(--c-surface-raised)',
            border: '1px solid var(--c-border)',
            borderRadius: 10,
            boxShadow: '0 12px 28px rgba(0,0,0,0.16)',
            zIndex: 40,
            padding: 14
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 12 }}>
            Writing Sprint
          </div>

          {sprint.phase === 'idle' && (
            <div style={{ display: 'flex', gap: 8 }}>
              {SPRINT_PRESET_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  onClick={() => sprint.start(minutes)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 7,
                    border: '1px solid var(--c-border)',
                    background: 'var(--c-bg)',
                    color: 'var(--c-ink)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {minutes}m
                </button>
              ))}
            </div>
          )}

          {sprint.phase === 'running' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Source Serif 4, serif', fontSize: 28, fontWeight: 600, marginBottom: 12 }}>
                {sprint.remainingLabel}
              </div>
              <button
                onClick={() => {
                  sprint.stop()
                }}
                style={{
                  width: '100%',
                  padding: '8px 0',
                  borderRadius: 7,
                  border: '1px solid var(--c-red)',
                  background: 'var(--c-red-soft)',
                  color: 'var(--c-red)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Stop sprint
              </button>
            </div>
          )}

          {sprint.phase === 'summary' && sprint.summary && (
            <div>
              <SprintSummaryText summary={sprint.summary} />
              <button
                onClick={() => {
                  sprint.dismissSummary()
                  setIsOpen(false)
                }}
                style={{
                  width: '100%',
                  marginTop: 12,
                  padding: '8px 0',
                  borderRadius: 7,
                  border: '1px solid var(--c-border)',
                  background: 'transparent',
                  color: 'var(--c-ink-soft)',
                  fontSize: 12.5,
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// A minimal, unobtrusive indicator shown in distraction-free mode (where the
// toolbar housing the button above is hidden) so a running or just-finished
// sprint isn't invisible during the very mode it's meant to support.
export function SprintTimerCompactPill({ sprint }: { sprint: SprintTimerState }): JSX.Element | null {
  if (sprint.phase === 'idle') return null

  return (
    <button
      onClick={sprint.phase === 'running' ? sprint.stop : sprint.dismissSummary}
      title={sprint.phase === 'running' ? 'Click to stop the sprint' : 'Click to dismiss'}
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        fontSize: 11.5,
        color: 'var(--c-amber)',
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 999,
        padding: '5px 14px',
        cursor: 'pointer'
      }}
    >
      {sprint.phase === 'running' ? (
        `Sprint · ${sprint.remainingLabel}`
      ) : sprint.summary ? (
        <SprintSummaryText summary={sprint.summary} compact />
      ) : null}
    </button>
  )
}

function SprintSummaryText({ summary, compact }: { summary: SprintSummary; compact?: boolean }): JSX.Element {
  const words = Math.max(0, summary.wordsWritten)
  const text = `${formatMmSs(summary.elapsedMs)} · ${words} word${words === 1 ? '' : 's'} written`
  if (compact) return <>{text}</>
  return <div style={{ fontSize: 13.5, color: 'var(--c-ink)', textAlign: 'center' }}>{text}</div>
}

const pillButtonStyle = {
  padding: '7px 13px',
  borderRadius: 7,
  border: '1px solid var(--c-border)',
  background: 'transparent',
  color: 'var(--c-ink-soft)',
  fontSize: 12.5,
  cursor: 'pointer'
} as const
