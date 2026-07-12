// Pure timing/word-delta math for SprintTimer, kept separate from the
// component so it's testable without mounting React or faking timers.

export const SPRINT_PRESET_MINUTES = [15, 25, 45] as const
export type SprintPresetMinutes = (typeof SPRINT_PRESET_MINUTES)[number]

export interface SprintSummary {
  elapsedMs: number
  wordsWritten: number
}

// Remaining time on the countdown, clamped to zero (never negative — a
// setInterval tick that lands slightly after the target instant shouldn't
// display a negative countdown).
export function remainingMs(startedAtMs: number, durationMs: number, nowMs: number): number {
  return Math.max(0, startedAtMs + durationMs - nowMs)
}

// The quiet end-of-sprint summary: elapsed wall-clock time (capped at the
// sprint's own duration for a natural completion, since a delayed timer
// tick or a manual stop a beat late shouldn't report more than the sprint
// that was set) and the word-count delta from the baseline captured at
// sprint start. Manual stops report true elapsed time instead, since a
// sprint stopped early legitimately ran for less than its target duration.
export function computeSprintSummary(params: {
  startedAtMs: number
  nowMs: number
  durationMs: number
  baselineWordCount: number
  currentWordCount: number
  completedNaturally: boolean
}): SprintSummary {
  const trueElapsed = Math.max(0, params.nowMs - params.startedAtMs)
  const elapsedMs = params.completedNaturally ? Math.min(trueElapsed, params.durationMs) : trueElapsed
  return {
    elapsedMs,
    wordsWritten: params.currentWordCount - params.baselineWordCount
  }
}

export function formatMmSs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
