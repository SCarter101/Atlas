import { describe, expect, it } from 'vitest'
import {
  TOUR_STEPS,
  clampTourStepIndex,
  isFirstTourStep,
  isLastTourStep,
  nextTourStepIndex,
  prevTourStepIndex
} from './onboardingTour'

describe('TOUR_STEPS', () => {
  it('is non-empty and has unique ids', () => {
    expect(TOUR_STEPS.length).toBeGreaterThan(0)
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only references already-stable nav-link selectors, never invented ones', () => {
    for (const step of TOUR_STEPS) {
      if (step.highlightSelector) {
        expect(step.highlightSelector).toMatch(/^a\[href="\/[a-z-]+"]$/)
      }
    }
  })
})

describe('tour step sequencing', () => {
  const length = TOUR_STEPS.length

  it('isFirstTourStep / isLastTourStep at the boundaries', () => {
    expect(isFirstTourStep(0)).toBe(true)
    expect(isFirstTourStep(1)).toBe(false)
    expect(isLastTourStep(length - 1, length)).toBe(true)
    expect(isLastTourStep(0, length)).toBe(false)
    expect(isLastTourStep(0, 0)).toBe(true)
  })

  it('nextTourStepIndex advances by one and clamps at the last step (no wrap)', () => {
    expect(nextTourStepIndex(0, length)).toBe(1)
    expect(nextTourStepIndex(length - 1, length)).toBe(length - 1)
    expect(nextTourStepIndex(length - 2, length)).toBe(length - 1)
  })

  it('prevTourStepIndex retreats by one and clamps at zero (no wrap)', () => {
    expect(prevTourStepIndex(length - 1, length)).toBe(length - 2)
    expect(prevTourStepIndex(0, length)).toBe(0)
  })

  it('index helpers degrade gracefully for an empty step list', () => {
    expect(nextTourStepIndex(0, 0)).toBe(0)
    expect(prevTourStepIndex(0, 0)).toBe(0)
    expect(clampTourStepIndex(0, 0)).toBe(0)
  })

  it('clampTourStepIndex bounds an out-of-range index into range', () => {
    expect(clampTourStepIndex(-3, length)).toBe(0)
    expect(clampTourStepIndex(length + 5, length)).toBe(length - 1)
    expect(clampTourStepIndex(1, length)).toBe(1)
  })
})
