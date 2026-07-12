import { useState } from 'react'
import type { AgentRole, MetadataProposalPayload, SuggestionRef } from '@shared/schema/agent'
import type { SceneCraftMeta, SceneMeta } from '@shared/schema/manuscript'
import { AssistantIcon, type IconKind } from './AssistantIcon'
import { useAtlasStore } from '../state/store'

const STATE_BADGE: Record<SuggestionRef['state'], { bg: string; color: string; label: string }> = {
  pending: { bg: 'var(--c-amber-soft)', color: 'var(--c-amber)', label: 'Open' },
  accepted: { bg: 'var(--c-green-soft)', color: 'var(--c-green)', label: 'Accepted' },
  rejected: { bg: 'var(--c-red-soft)', color: 'var(--c-red)', label: 'Rejected' },
  refining: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent-text)', label: 'In progress' },
  fixed: { bg: 'var(--c-accent-soft)', color: 'var(--c-accent)', label: 'Fixed' }
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

const FIELD_LABEL: Record<string, string> = {
  title: 'Title',
  povCharacterId: 'POV character',
  locationId: 'Location',
  timeOrDate: 'Time / date',
  purpose: 'Purpose',
  status: 'Status',
  characterDesire: 'Character desire',
  externalGoal: 'External goal',
  internalConflict: 'Internal conflict',
  opposition: 'Opposition',
  stakes: 'Stakes',
  turningPoint: 'Turning point',
  outcome: 'Outcome',
  emotionalShift: 'Emotional shift',
  revealedInformation: 'Revealed information'
}

// Flattens the proposed patch's top-level fields plus its (optional) nested
// `craft` fields into a flat list of { field, label, value } rows for the
// diff-style preview — mirrors how SceneMetadataPanel.tsx displays
// SceneCraftMeta as a flat field grid, so the proposal previews the same
// shape the writer will actually see once accepted.
function diffRows(
  proposed: Partial<SceneMeta>,
  current: SceneMeta | undefined
): { field: string; label: string; proposedValue: string; currentValue?: string }[] {
  const rows: { field: string; label: string; proposedValue: string; currentValue?: string }[] = []

  for (const [key, value] of Object.entries(proposed)) {
    if (key === 'craft' || key === 'continuity' || value === undefined) continue
    rows.push({
      field: key,
      label: FIELD_LABEL[key] ?? key,
      proposedValue: String(value),
      currentValue: current ? (current as unknown as Record<string, unknown>)[key]?.toString() : undefined
    })
  }

  if (proposed.craft) {
    const currentCraft: SceneCraftMeta | undefined = current?.craft
    for (const [key, value] of Object.entries(proposed.craft)) {
      if (value === undefined) continue
      rows.push({
        field: key,
        label: FIELD_LABEL[key] ?? key,
        proposedValue: String(value),
        currentValue: currentCraft ? currentCraft[key as keyof SceneCraftMeta] : undefined
      })
    }
  }

  return rows
}

// Renders a Dev-Editor `metadata-proposal` suggestion — spec Phase 4 (~line
// 183): agents may propose scene metadata based on the current draft, but
// the writer must approve. Shows a small diff-style preview (proposed value
// vs. current, when there is one) rather than writing anything until the
// writer accepts; follows the attribution-header/tint/Accept-Reject-Refine
// conventions established by EditorialFindingCard.tsx and CodexAdditionCard.tsx.
export function MetadataProposalCard({ suggestion }: { suggestion: SuggestionRef }): JSX.Element {
  const setSuggestionState = useAtlasStore((s) => s.setSuggestionState)
  const manuscriptTree = useAtlasStore((s) => s.manuscriptTree)
  const [refining, setRefining] = useState(false)
  const [refineText, setRefineText] = useState('')

  const payload = suggestion.payload as MetadataProposalPayload
  const isResolved = suggestion.state === 'accepted' || suggestion.state === 'rejected'
  const badge = STATE_BADGE[suggestion.state]

  const currentScene = (manuscriptTree?.books ?? [])
    .flatMap((b) => b.parts.flatMap((p) => p.chapters.flatMap((c) => c.scenes)))
    .find((s) => s.id === suggestion.targetSceneId)

  const rows = diffRows(payload.proposedMeta, currentScene)

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

      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 6 }}>Proposed metadata update</div>
      <div style={{ fontSize: 12, color: 'var(--c-ink-soft)', lineHeight: 1.5, marginBottom: 10 }}>{payload.rationale}</div>

      {rows.length > 0 && (
        <div
          style={{
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 10,
            background: 'var(--c-surface)'
          }}
        >
          {rows.map((row) => (
            <div key={row.field} style={{ fontSize: 11.5, marginBottom: 6 }}>
              <div style={{ color: 'var(--c-ink-faint)', marginBottom: 2 }}>{row.label}</div>
              {row.currentValue ? (
                <div>
                  <span style={{ color: 'var(--c-red)', textDecoration: 'line-through', marginRight: 6 }}>{row.currentValue}</span>
                  <span style={{ color: 'var(--c-green)' }}>{row.proposedValue}</span>
                </div>
              ) : (
                <div style={{ color: 'var(--c-green)' }}>{row.proposedValue}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10.5, color: 'var(--c-ink-faint)', marginBottom: 10, fontStyle: 'italic' }}>
        Proposed by {ROLE_NAME[suggestion.agentRole]} — accepting applies this to the scene's metadata; nothing is written until then.
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
