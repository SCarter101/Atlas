import { useState } from 'react'
import type { SuggestionRef } from '@shared/schema/agent'
import { useAtlasStore } from '../state/store'

// Every agent suggestion goes through this one component and the same
// Accept / Reject / Refine actions, regardless of originating agent — see
// spec §10 "Universal AI Suggestion Contract". Styled after the Phase 1
// prototype's ReviewPanel.dc.html tracked-change cards.
export function SuggestionCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')

  const payload = suggestion.payload as { category: string; before: string; after: string }
  const isResolved = suggestion.state === 'accepted' || suggestion.state === 'rejected'

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 10,
        border: '1px solid var(--c-border)',
        background: 'var(--c-surface-raised)',
        opacity: isResolved ? 0.55 : 1
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 10,
            background: 'var(--c-accent-soft)',
            color: 'var(--c-accent-text)'
          }}
        >
          {payload.category}
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', textTransform: 'capitalize' }}>{suggestion.state}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', textDecoration: 'line-through', marginBottom: 4, lineHeight: 1.5 }}>
        {payload.before}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-ink)', lineHeight: 1.5, marginBottom: isResolved && !refining ? 0 : 10 }}>
        {payload.after}
      </div>

      {!isResolved && refining && (
        <>
          <textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="Follow-up instruction…"
            style={{
              width: '100%',
              minHeight: 48,
              border: '1px solid var(--c-border)',
              borderRadius: 7,
              padding: 8,
              fontSize: 12,
              fontFamily: 'Public Sans, sans-serif',
              marginBottom: 8,
              resize: 'vertical',
              background: 'var(--c-bg)',
              color: 'var(--c-ink)'
            }}
          />
          <button
            onClick={() => {
              setSuggestionState(suggestion.id, 'refining')
              setRefining(false)
            }}
            style={{
              width: '100%',
              padding: '6px 0',
              borderRadius: 6,
              border: 'none',
              background: 'var(--c-accent)',
              color: '#fff',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Send refinement
          </button>
        </>
      )}
      {!isResolved && !refining && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setSuggestionState(suggestion.id, 'accepted')} style={pillStyle('var(--c-green-soft)', 'var(--c-green)')}>
            Accept
          </button>
          <button onClick={() => setSuggestionState(suggestion.id, 'rejected')} style={pillStyle('var(--c-red-soft)', 'var(--c-red)')}>
            Reject
          </button>
          <button onClick={() => setRefining(true)} style={pillStyle('transparent', 'var(--c-ink-soft)', true)}>
            Refine
          </button>
        </div>
      )}
    </div>
  )
}

function pillStyle(bg: string, color: string, outlined = false) {
  return {
    flex: 1,
    padding: '6px 0',
    borderRadius: 6,
    border: outlined ? '1px solid var(--c-border)' : 'none',
    background: bg,
    color,
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer'
  } as const
}
