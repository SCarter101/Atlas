import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TOUR_STEPS,
  isFirstTourStep,
  isLastTourStep,
  nextTourStepIndex,
  prevTourStepIndex
} from '../lib/onboardingTour'
import { markTourSeen } from '../lib/onboardingStorage'

interface HighlightRect {
  top: number
  left: number
  width: number
  height: number
}

// Skippable, multi-step walkthrough of the core loop (spec: open/create a
// project -> Story Foundations -> manuscript editor -> Agent Rail ->
// suggestion review -> export). Renderer-only by design (see
// lib/onboardingStorage.ts) — no IPC, no main-process changes, so it can't
// collide with any sibling Round 10 track's shared-plumbing edits.
//
// Highlighting is intentionally conservative: it only ever targets
// selectors the tour's own step data names (see onboardingTour.ts), and
// those selectors are existing, already-stable `<a href>` nav links
// rendered by AppShell.tsx today — never a selector assumed to exist in an
// unmerged sibling track's file.
export function ProductTour({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const navigate = useNavigate()
  const [stepIndex, setStepIndex] = useState(0)
  const [highlight, setHighlight] = useState<HighlightRect | null>(null)

  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  const step = TOUR_STEPS[stepIndex]

  useEffect(() => {
    if (!open || !step?.route) return
    navigate(step.route)
  }, [open, step, navigate])

  useEffect(() => {
    if (!open || !step) {
      setHighlight(null)
      return
    }
    function measure(): void {
      if (!step.highlightSelector) {
        setHighlight(null)
        return
      }
      const el = document.querySelector(step.highlightSelector)
      if (!el) {
        setHighlight(null)
        return
      }
      const rect = el.getBoundingClientRect()
      setHighlight({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
    // A route change above may still be committing when this effect runs;
    // measuring one tick later gives the target element (if any) a chance
    // to actually be in the DOM.
    const timer = setTimeout(measure, 60)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, step])

  function goNext(): void {
    if (isLastTourStep(stepIndex, TOUR_STEPS.length)) {
      finish()
      return
    }
    setStepIndex((i) => nextTourStepIndex(i, TOUR_STEPS.length))
  }

  function goPrev(): void {
    setStepIndex((i) => prevTourStepIndex(i, TOUR_STEPS.length))
  }

  function finish(): void {
    markTourSeen()
    onClose()
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // goNext/goPrev/finish close over stepIndex; re-subscribing per step
    // keeps arrow-key navigation in sync without a stale-closure bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex])

  if (!open || !step) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 210, pointerEvents: 'none' }}>
      <div
        onClick={finish}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', pointerEvents: 'auto' }}
      />

      {highlight && (
        <div
          style={{
            position: 'fixed',
            top: highlight.top - 6,
            left: highlight.left - 6,
            width: highlight.width + 12,
            height: highlight.height + 12,
            borderRadius: 10,
            border: '2px solid var(--c-accent)',
            background: 'rgba(255,255,255,0.06)',
            pointerEvents: 'none',
            transition: 'top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease'
          }}
        />
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Atlas product tour"
        style={{
          position: 'fixed',
          right: 28,
          bottom: 28,
          width: 360,
          maxWidth: 'calc(100vw - 56px)',
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)',
          boxShadow: '0 20px 48px rgba(0,0,0,0.3)',
          padding: 22,
          pointerEvents: 'auto'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--c-ink-faint)'
            }}
          >
            Step {stepIndex + 1} of {TOUR_STEPS.length}
          </span>
          <button
            onClick={finish}
            title="Skip tour"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--c-ink-faint)',
              fontSize: 16,
              lineHeight: 1,
              padding: 0
            }}
          >
            ×
          </button>
        </div>

        <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--c-ink)' }}>
          {step.title}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--c-ink-soft)', marginBottom: 18 }}>{step.body}</div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            onClick={finish}
            style={{
              padding: '7px 12px',
              borderRadius: 7,
              border: '1px solid var(--c-border)',
              background: 'transparent',
              color: 'var(--c-ink-faint)',
              fontSize: 12.5,
              cursor: 'pointer'
            }}
          >
            Skip
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {!isFirstTourStep(stepIndex) && (
              <button
                onClick={goPrev}
                style={{
                  padding: '7px 14px',
                  borderRadius: 7,
                  border: '1px solid var(--c-border)',
                  background: 'transparent',
                  color: 'var(--c-ink)',
                  fontSize: 12.5,
                  cursor: 'pointer'
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={goNext}
              style={{
                padding: '7px 16px',
                borderRadius: 7,
                border: 'none',
                background: 'var(--c-accent)',
                color: 'var(--c-bg)',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {isLastTourStep(stepIndex, TOUR_STEPS.length) ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
