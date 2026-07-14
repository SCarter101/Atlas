import { useState } from 'react'
import type { AgentRole, CapabilityRecommendationPayload, SuggestionRef } from '@shared/schema/agent'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'

const STATE_BADGE: Record<SuggestionRef['state'], { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Installed' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  // 'fixed' is Story-Editor-specific (EditorialFindingCard.tsx) and never
  // produced for a capability-recommendation — entry included only so this
  // Record<SuggestionRef['state'], ...> stays exhaustive.
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

// Renders a `capability-recommendation` suggestion — spec Phase 4
// ("Capability recommendations based on repeated real writing workflows"):
// an agent role noticed it called the same tool across 3+ separate past
// runs (see detectRepeatedToolPattern in main/agent/simulator.ts) and drafted
// a capability manifest the writer can install. Unlike every other
// suggestion kind, "Accept" here has a real side effect beyond flipping
// suggestion state — installing the draft manifest via `capabilities:create`
// — but that side effect lives in state/store.ts's setSuggestionState
// (alongside the tracked-change/insertion/metadata-proposal accept-time
// branches), not here, so this card's individual Accept button and a
// section's "Accept all" batch action (which also calls setSuggestionState)
// both actually install the capability instead of only the former.
export function CapabilityRecommendationCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const refineSuggestion = useAtlasStore((s) => s.refineSuggestion)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const payload = suggestion.payload as CapabilityRecommendationPayload
  const isResolved = suggestion.state === 'accepted' || suggestion.state === 'rejected'
  const badge = STATE_BADGE[suggestion.state]

  async function handleAccept(): Promise<void> {
    if (installing) return
    setInstalling(true)
    setInstallError(null)
    try {
      await setSuggestionState(suggestion.id, 'accepted')
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not install this capability.')
    } finally {
      setInstalling(false)
    }
  }

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

      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 6 }}>
        Recommended capability: {payload.draftManifest.name}
      </div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 8 }}>{payload.rationale}</div>

      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 10, fontStyle: 'italic' }}>
        Called {payload.occurrences} separate times across past runs — accepting installs a project-scoped capability
        (draft, not yet enabled) that you can review and enable from the Library.
      </div>

      {installError && (
        <div style={{ fontSize: 11.5, color: 'var(--c-red)', marginBottom: 8 }}>{installError}</div>
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
              void refineSuggestion(suggestion.id, refineText)
              setRefining(false)
              setRefineText('')
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
          <button onClick={handleAccept} disabled={installing} style={pillStyle('var(--c-green-soft)', 'var(--c-green)')}>
            {installing ? 'Installing…' : 'Accept'}
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
