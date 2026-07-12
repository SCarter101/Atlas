import { describe, expect, it } from 'vitest'
import { computeSprintSummary, formatMmSs, remainingMs } from './sprintLogic'

describe('remainingMs', () => {
  it('counts down toward zero', () => {
    expect(remainingMs(1000, 60000, 1000)).toBe(60000)
    expect(remainingMs(1000, 60000, 31000)).toBe(30000)
  })

  it('clamps at zero rather than going negative', () => {
    expect(remainingMs(1000, 60000, 999999)).toBe(0)
  })
})

describe('computeSprintSummary', () => {
  it('reports the words written as the delta from baseline', () => {
    const summary = computeSprintSummary({
      startedAtMs: 0,
      nowMs: 60000,
      durationMs: 60000,
      baselineWordCount: 500,
      currentWordCount: 640,
      completedNaturally: true
    })
    expect(summary.wordsWritten).toBe(140)
  })

  it('allows a negative delta (heavy deletion during the sprint)', () => {
    const summary = computeSprintSummary({
      startedAtMs: 0,
      nowMs: 60000,
      durationMs: 60000,
      baselineWordCount: 500,
      currentWordCount: 480,
      completedNaturally: true
    })
    expect(summary.wordsWritten).toBe(-20)
  })

  it('caps elapsed time at the sprint duration on natural completion', () => {
    // A setInterval tick landing a beat after the exact target instant
    // shouldn't report more elapsed time than the sprint that was set.
    const summary = computeSprintSummary({
      startedAtMs: 0,
      nowMs: 60400,
      durationMs: 60000,
      baselineWordCount: 0,
      currentWordCount: 0,
      completedNaturally: true
    })
    expect(summary.elapsedMs).toBe(60000)
  })

  it('reports true elapsed time on a manual stop, even if short of the duration', () => {
    const summary = computeSprintSummary({
      startedAtMs: 0,
      nowMs: 40000,
      durationMs: 60000,
      baselineWordCount: 0,
      currentWordCount: 0,
      completedNaturally: false
    })
    expect(summary.elapsedMs).toBe(40000)
  })
})

describe('formatMmSs', () => {
  it('formats sub-minute durations with a zero-padded seconds field', () => {
    expect(formatMmSs(5000)).toBe('0:05')
  })

  it('formats multi-minute durations', () => {
    expect(formatMmSs(25 * 60000)).toBe('25:00')
  })

  it('rounds to the nearest second', () => {
    expect(formatMmSs(59700)).toBe('1:00')
  })
})
