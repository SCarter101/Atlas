import { useState, type CSSProperties } from 'react'
import {
  WORLD_BUILDER_GENRE_TEMPLATES,
  WORLD_BUILDER_INTERVIEW_TOPICS,
  emptyWorldBuilderInterviewAnswers,
  type WorldBuilderInterviewAnswers
} from '@shared/worldBuilderInterview'

// Multi-step World Builder interview wizard (spec §7.5: "World Builder
// should begin with an interview process" covering, at minimum, the six
// topics in WORLD_BUILDER_INTERVIEW_TOPICS, plus genre-specific templates).
// Purely a renderer-side, ephemeral flow — nothing here is persisted; the
// only lasting output is the Codex entries the World Builder run proposes
// from the compiled answers, which go through the normal
// CodexAdditionCard accept/reject/refine approval flow like any other
// suggestion. See AgentRail.tsx for how the compiled answers get turned
// into an AgentGoal.
//
// Step 0 is the genre-template picker; steps 1-6 are the six interview
// topics (one free-text answer each, driven by WORLD_BUILDER_INTERVIEW_TOPICS
// so adding/reordering a topic there doesn't require touching this
// component); step 7 is a review/submit screen.
const TOTAL_STEPS = WORLD_BUILDER_INTERVIEW_TOPICS.length + 2
const TEMPLATE_STEP = 0
const REVIEW_STEP = TOTAL_STEPS - 1

export function WorldBuilderInterview({
  onSubmit,
  onCancel
}: {
  onSubmit: (answers: WorldBuilderInterviewAnswers) => void
  onCancel: () => void
}): JSX.Element {
  const [step, setStep] = useState(TEMPLATE_STEP)
  const [answers, setAnswers] = useState<WorldBuilderInterviewAnswers>(emptyWorldBuilderInterviewAnswers)

  const isTopicStep = step >= 1 && step <= WORLD_BUILDER_INTERVIEW_TOPICS.length
  const topic = isTopicStep ? WORLD_BUILDER_INTERVIEW_TOPICS[step - 1] : undefined

  function next(): void {
    setStep((s) => Math.min(s + 1, REVIEW_STEP))
  }

  function back(): void {
    setStep((s) => Math.max(s - 1, TEMPLATE_STEP))
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
    >
      <div
        style={{
          width: 560,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 14,
          background: 'var(--c-surface-raised)',
          border: '1px solid var(--c-border)',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '20px 24px 0' }}>
          <div style={{ fontFamily: 'Source Serif 4, serif', fontWeight: 600, fontSize: 18, marginBottom: 4 }}>
            World Builder Interview
          </div>
          <div style={{ fontSize: 12, color: 'var(--c-ink-faint)', marginBottom: 14 }}>
            {step === TEMPLATE_STEP && 'Pick the template that best matches this world — or go custom.'}
            {isTopicStep && `Topic ${step} of ${WORLD_BUILDER_INTERVIEW_TOPICS.length}`}
            {step === REVIEW_STEP && 'Review your answers before World Builder proposes Codex entries.'}
          </div>
          <ProgressBar step={step} total={TOTAL_STEPS} />
        </div>

        <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1 }}>
          {step === TEMPLATE_STEP && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {WORLD_BUILDER_GENRE_TEMPLATES.map((template) => {
                const selected = answers.genreTemplate === template.id
                return (
                  <button
                    key={template.id}
                    onClick={() => setAnswers((a) => ({ ...a, genreTemplate: template.id }))}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 9,
                      border: `1px solid ${selected ? 'var(--c-accent)' : 'var(--c-border)'}`,
                      background: selected ? 'var(--c-accent-soft)' : 'var(--c-surface)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{template.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', marginTop: 2 }}>{template.blurb}</div>
                  </button>
                )
              })}
            </div>
          )}

          {isTopicStep && topic && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 10, lineHeight: 1.4 }}>
                {topic.question}
              </div>
              <textarea
                value={answers[topic.key]}
                onChange={(e) => setAnswers((a) => ({ ...a, [topic.key]: e.target.value }))}
                placeholder={topic.placeholder}
                autoFocus
                style={{
                  width: '100%',
                  minHeight: 160,
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--c-border)',
                  background: 'var(--c-surface)',
                  color: 'var(--c-ink)',
                  fontSize: 13,
                  fontFamily: 'Public Sans, sans-serif',
                  resize: 'vertical'
                }}
              />
              <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginTop: 6 }}>
                Optional — leave blank if this doesn't apply yet. You can revise this later.
              </div>
            </div>
          )}

          {step === REVIEW_STEP && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ReviewRow
                label="Genre template"
                value={WORLD_BUILDER_GENRE_TEMPLATES.find((t) => t.id === answers.genreTemplate)?.label ?? 'Custom'}
              />
              {WORLD_BUILDER_INTERVIEW_TOPICS.map((t) => (
                <ReviewRow key={t.key} label={t.question} value={answers[t.key] || '(not answered)'} />
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', fontStyle: 'italic' }}>
                World Builder will propose Codex entries synthesized from these answers. Nothing is written to the
                Codex until you review and accept each proposal.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: '14px 24px', borderTop: '1px solid var(--c-border)' }}>
          <button onClick={onCancel} style={btnStyle('secondary')}>
            Cancel
          </button>
          <div style={{ flex: 1 }} />
          {step > TEMPLATE_STEP && (
            <button onClick={back} style={btnStyle('secondary')}>
              Back
            </button>
          )}
          {step < REVIEW_STEP ? (
            <button onClick={next} style={btnStyle('primary')}>
              Next
            </button>
          ) : (
            <button onClick={() => onSubmit(answers)} style={btnStyle('primary')}>
              Run World Builder
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProgressBar({ step, total }: { step: number; total: number }): JSX.Element {
  const pct = Math.round(((step + 1) / total) * 100)
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'var(--c-border)', overflow: 'hidden', marginBottom: 4 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--c-accent)', borderRadius: 3 }} />
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--c-ink-faint)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

function btnStyle(kind: 'primary' | 'secondary'): CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: kind === 'primary' ? 600 : 400,
    cursor: 'pointer',
    border: kind === 'primary' ? 'none' : '1px solid var(--c-border)',
    background: kind === 'primary' ? 'var(--c-accent)' : 'transparent',
    color: kind === 'primary' ? '#fff' : 'var(--c-ink-soft)'
  }
}
