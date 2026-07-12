import { useState } from 'react'
import type { AgentRole, SuggestionRef } from '@shared/schema/agent'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'

const RELIABILITY_LABEL: Record<'low' | 'medium' | 'high' | 'author-stated', string> = {
  low: 'low reliability',
  medium: 'medium reliability',
  high: 'high reliability',
  'author-stated': 'from your interview answers'
}

const STATE_BADGE: Record<SuggestionRef['state'], { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Accepted' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  // 'fixed' is Story-Editor-specific (EditorialFindingCard.tsx) and never
  // produced for a codex-addition — entry included only so this
  // Record<SuggestionRef['state'], ...> stays exhaustive after the shared
  // state union grew a 'fixed' member.
  fixed: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'Fixed' }
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

// Renders a World-Builder-agent `codex-addition` suggestion — a proposed new
// Codex entry. Accepting only flips the suggestion's own state, the same as
// every other kind (spec §10's Universal Suggestion Contract); actually
// writing the entry into the Codex is out of scope for this pass.
export function CodexAdditionCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')

  const payload = suggestion.payload as {
    entryType: string
    name: string
    summary: string
    // 'author-stated' is distinct from the low/medium/high research-quality
    // tiers — it marks a proposal synthesized directly from the writer's own
    // World Builder interview answers (see deriveWorldBuilderProposals in
    // main/agent/simulator.ts), never fabricated or web-researched, so it
    // shouldn't be lumped in with (or mistaken for) a "low reliability"
    // guess the way the plain single-selection flow's proposals are.
    citations?: { note: string; reliability?: 'low' | 'medium' | 'high' | 'author-stated' }[]
  }
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
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-ink-soft)' }}>{ROLE_NAME[suggestion.agentRole]}</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: badge.bg, color: badge.color }}>
          {badge.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-ink)' }}>{payload.name}</span>
        <span style={{ fontSize: 10, color: 'var(--c-ink-faint)', textTransform: 'capitalize' }}>{payload.entryType}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>{payload.summary}</div>

      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 8, fontStyle: 'italic' }}>
        Proposed Codex addition — requires approval. Accepting here does not write the entry into the Codex yet.
      </div>

      {payload.citations && payload.citations.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {payload.citations.map((c, i) => (
            <div key={i} style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', lineHeight: 1.4 }}>
              {c.note}
              {c.reliability ? ` (${RELIABILITY_LABEL[c.reliability]})` : ''}
            </div>
          ))}
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
