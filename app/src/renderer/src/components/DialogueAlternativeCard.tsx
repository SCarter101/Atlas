import { useState } from 'react'
import type { AgentRole, DialogueAlternativePayload, DialogueTensionTier, SuggestionRef } from '@shared/schema/agent'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'

// Keyed on `SuggestionRef['state'] | 'fixed'` rather than just
// `SuggestionRef['state']` because a parallel round of work is adding a
// 'fixed' state to that shared union (shared/schema/agent.ts) without
// touching this file's badge map — see this round's brief. Widening the key
// type here (instead of narrowing to the current union) means this map
// already has the right entry once that union lands, with no further edit
// needed to this file.
const STATE_BADGE: Record<SuggestionRef['state'] | 'fixed', { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Accepted' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  fixed: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Fixed' }
}

const TENSION_LABEL: Record<DialogueTensionTier, string> = {
  calm: 'Calm',
  guarded: 'Guarded',
  confrontational: 'Confrontational'
}

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

// Renders a Dialoguer-agent `dialogue-alternative` suggestion — the original
// line plus a short list of alternate phrasings. Same Universal Suggestion
// Contract (Accept/Reject/Refine, spec §10) as the other suggestion cards.
export function DialogueAlternativeCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const refineSuggestion = useAtlasStore((s) => s.refineSuggestion)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')

  const payload = suggestion.payload as DialogueAlternativePayload
  const isResolved = suggestion.state === 'accepted' || suggestion.state === 'rejected'
  const badge = STATE_BADGE[suggestion.state]

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--c-accent-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <AssistantIcon kind={ROLE_ICON[suggestion.agentRole]} color="var(--c-accent)" size={12} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-ink-soft)' }}>
            {ROLE_NAME[suggestion.agentRole]}
            {payload.characterName ? ` · ${payload.characterName}` : ''}
          </span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--c-ink-faint)', textDecoration: 'line-through', marginBottom: 8, lineHeight: 1.5 }}>
        {payload.original}
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-ink-faint)', marginBottom: 6 }}>
        Alternatives by tension level
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {payload.alternatives.map((alt, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--c-ink-faint)',
                width: 92,
                flexShrink: 0
              }}
            >
              {TENSION_LABEL[alt.tier]}
            </span>
            <span style={{ fontSize: 12, color: 'var(--c-ink)', lineHeight: 1.5 }}>{alt.text}</span>
          </div>
        ))}
      </div>

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
              void refineSuggestion(suggestion.id, refineText)
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
