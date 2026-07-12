import { useState } from 'react'
import type { AgentRole, EditorialFindingPayload, SuggestionRef } from '@shared/schema/agent'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'
import { CRAFT_CONCEPTS } from '../lib/craftReference'

const STATE_BADGE: Record<SuggestionRef['state'], { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Accepted' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  fixed: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent)', label: 'Fixed' }
}

// Role -> stable icon / display name, per spec §10 "Universal AI Suggestion
// Contract" — every suggestion must be attributed to its originating agent.
// Mirrors AgentRail.tsx / ManuscriptWorkspace.tsx's ROLE_NAME; duplicated
// locally on purpose to keep this file isolated.
const ROLE_ICON: Record<AgentRole, IconKind> = {
  Generator: 'nib',
  'Dev-Editor': 'compass',
  'Line-Editor': 'loupe',
  Dialoguer: 'quote',
  'World-Builder': 'globe'
}
const ROLE_NAME: Record<AgentRole, string> = {
  Generator: 'Generator',
  'Dev-Editor': 'Story Editor',
  'Line-Editor': 'Line Editor',
  Dialoguer: 'Dialogue Editor',
  'World-Builder': 'World Builder'
}

// Ported from the Phase 1 prototype's ReviewPanel.dc.html Story Editor
// issue card. Structural findings still go through the same Universal
// Suggestion Contract (Accept/Reject/Refine) as tracked changes — see spec
// §10 — just rendered with the title/body/severity shape that fits a
// developmental-editing finding instead of a before/after diff.
export function EditorialFindingCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')

  const payload = suggestion.payload as EditorialFindingPayload
  // 'rejected'/'fixed' are terminal — no further action. 'accepted' still
  // gets one action (Mark Fixed): accepting a finding only acknowledges it,
  // it doesn't touch the manuscript (see store.ts's setSuggestionState), so
  // the writer needs a separate way to say the underlying prose issue has
  // actually been resolved once they've done the rewrite themselves.
  const isTerminal = suggestion.state === 'rejected' || suggestion.state === 'fixed'
  const isResolved = isTerminal || suggestion.state === 'accepted'
  const badge = STATE_BADGE[suggestion.state]
  const craftConcepts = (payload.craftConceptIds ?? []).map((id) => CRAFT_CONCEPTS[id]).filter(Boolean)
  const [openConceptId, setOpenConceptId] = useState<string | null>(null)

  return (
    <div
      style={{
        border: '1px solid var(--c-border)',
        borderRadius: 10,
        padding: 12,
        marginBottom: 10,
        background: 'var(--c-surface-raised)',
        opacity: isResolved ? 0.7 : 1
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--c-accent-soft)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <AssistantIcon kind={ROLE_ICON[suggestion.agentRole]} color="var(--c-accent)" size={10} />
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--c-ink-faint)' }}>{ROLE_NAME[suggestion.agentRole]}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{payload.title}</span>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 10 }}>{payload.body}</div>
      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 10 }}>Severity: {payload.severity}</div>

      {craftConcepts.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {craftConcepts.map((concept) => (
              <button
                key={concept.id}
                onClick={() => setOpenConceptId((cur) => (cur === concept.id ? null : concept.id))}
                style={{
                  fontSize: 10.5,
                  padding: '3px 9px',
                  borderRadius: 12,
                  border: '1px solid var(--c-border)',
                  background: openConceptId === concept.id ? 'var(--c-accent-soft)' : 'transparent',
                  color: openConceptId === concept.id ? 'var(--c-accent-text)' : 'var(--c-ink-faint)',
                  cursor: 'pointer'
                }}
              >
                {concept.label} {openConceptId === concept.id ? '▾' : '▸'}
              </button>
            ))}
          </div>
          {openConceptId && craftConcepts.some((c) => c.id === openConceptId) && (
            <div
              style={{
                marginTop: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--c-surface)',
                border: '1px solid var(--c-border)',
                fontSize: 11.5,
                color: 'var(--c-ink-soft)',
                lineHeight: 1.5
              }}
            >
              {craftConcepts.find((c) => c.id === openConceptId)?.explainer}
            </div>
          )}
        </div>
      )}

      {!isResolved && refining && (
        <>
          <textarea
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            placeholder="Follow-up instruction…"
            style={{
              width: '100%',
              minHeight: 52,
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
              padding: '7px 0',
              borderRadius: 7,
              border: 'none',
              background: 'var(--c-accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Send refinement
          </button>
        </>
      )}
      {(suggestion.state === 'pending' || suggestion.state === 'refining') && !refining && (
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
      {suggestion.state === 'accepted' && (
        <button
          onClick={() => setSuggestionState(suggestion.id, 'fixed')}
          style={pillStyle('var(--c-accent-soft)', 'var(--c-accent)')}
        >
          Mark Fixed
        </button>
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
